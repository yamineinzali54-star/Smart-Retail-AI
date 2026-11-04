import "server-only";

import { and, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { items, products } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { aiServiceAuthHeaders } from "@/lib/ai-service";
import {
  getSelectableAiModels,
  recordAiModelUsage,
  reserveAiModel,
} from "@/lib/ai-model-settings";

// GET /api/ai/pricing — thin-margin relay. Session roles: admin + inventory.
// The web app pulls weighted-average cost/price per product from the branch
// stock rows (Drizzle), then forwards to the Python AI service
// (price_optimize job — rule-based margin flags, never auto-reprices).
// Narration uses the DB-stored model credentials when a model is selected
// (explicit modelId, else the configured default); with no model configured
// it falls back to the AI service env/stub path (rule-based narration).

const querySchema = z.object({
  min_margin_pct: z.coerce.number().min(0).max(90).default(10),
  modelId: z.string().uuid().optional(),
});

function aiServiceUrl(): string {
  return (process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.role !== "inventory") {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const { modelId, ...jobParams } = parsed.data;

  const batches = await db
    .select({
      productId: products.id,
      productName: products.name,
      onHand: items.currentStockQuantity,
      cost: items.purchasePrice,
      price: items.sellingPrice,
    })
    .from(items)
    .innerJoin(products, and(eq(products.id, items.productId), eq(products.isDeleted, false)))
    .where(
      and(
        eq(items.branchId, session.user.branchId),
        eq(products.branchId, session.user.branchId),
        eq(products.isDeleted, false),
        gt(items.currentStockQuantity, 0),
      ),
    );

  const weighted = new Map<string, {
    product_id: string; product_name: string; quantity: number;
    cost_total: number; price_total: number;
  }>();
  for (const row of batches) {
    const quantity = Number(row.onHand);
    const cost = Number(row.cost);
    const price = Number(row.price);
    if (
      !Number.isFinite(quantity) || quantity <= 0 ||
      !Number.isFinite(cost) || cost < 0 ||
      !Number.isFinite(price) || price <= 0
    ) continue;
    const entry = weighted.get(row.productId) ?? {
      product_id: row.productId,
      product_name: row.productName,
      quantity: 0,
      cost_total: 0,
      price_total: 0,
    };
    entry.quantity += quantity;
    entry.cost_total += cost * quantity;
    entry.price_total += price * quantity;
    weighted.set(row.productId, entry);
  }
  const analysisItems = [...weighted.values()].map((item) => ({
    product_id: item.product_id,
    product_name: item.product_name,
    cost: item.cost_total / item.quantity,
    price: item.price_total / item.quantity,
  }));

  if (analysisItems.length === 0) {
    return NextResponse.json({
      ok: true,
      model: null,
      item_count: 0,
      min_margin_pct: jobParams.min_margin_pct,
      flags: [],
      insights: "",
    });
  }

  // Explicit modelId → must be reservable (429 otherwise). No modelId →
  // configured default when present, else env/stub path on the AI service.
  let selected: { id: string; name: string; provider: string; apiKey: string; maxTokens: number | null } | null = null;
  if (modelId) {
    const reservation = await reserveAiModel(modelId);
    if (!reservation.ok) {
      return NextResponse.json({ ok: false, error: reservation.error }, { status: 429 });
    }
    selected = {
      id: reservation.model.id,
      name: reservation.model.name,
      provider: reservation.model.provider,
      apiKey: reservation.model.apiKey,
      maxTokens: reservation.model.providerMaxOutputTokens,
    };
  } else {
    const defaultModel = (await getSelectableAiModels()).find((m) => m.isDefault);
    if (defaultModel) {
      const reservation = await reserveAiModel(defaultModel.id);
      if (reservation.ok) {
        selected = {
          id: reservation.model.id,
          name: reservation.model.name,
          provider: reservation.model.provider,
          apiKey: reservation.model.apiKey,
          maxTokens: reservation.model.providerMaxOutputTokens,
        };
      }
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  let upstream: Response;
  try {
    const headers = new Headers({ "content-type": "application/json" });
    if (selected) {
      headers.set("x-ai-model-provider", selected.provider);
      headers.set("x-ai-model", selected.name);
      headers.set("x-ai-api-key", selected.apiKey);
      if (selected.maxTokens) headers.set("x-ai-max-tokens", String(selected.maxTokens));
    }
    upstream = await fetch(`${aiServiceUrl()}/jobs/enqueue`, {
      method: "POST",
      headers: aiServiceAuthHeaders(headers),
      body: JSON.stringify({
        job_type: "price_optimize",
        branch_id: session.user.branchId,
        params: {
          items: analysisItems,
          min_margin_pct: jobParams.min_margin_pct,
          narrate: true,
        },
      }),
      signal: controller.signal,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "AI_UNAVAILABLE" }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }

  if (upstream.status === 429) {
    return NextResponse.json({ ok: false, error: "AI_QUOTA_EXCEEDED" }, { status: 429 });
  }
  if (!upstream.ok) {
    return NextResponse.json({ ok: false, error: "AI_UNAVAILABLE" }, { status: 503 });
  }
  const data = await upstream.json().catch(() => null);
  const usage = data?.usage;
  const totalTokens = Number(usage?.total_tokens);
  const costUsd = Number(usage?.cost_usd);
  const costReported = usage?.cost_reported === true;
  if (selected && Number.isFinite(totalTokens) && totalTokens >= 0) {
    await recordAiModelUsage(selected.id, {
      totalTokens,
      costUsd: costReported && Number.isFinite(costUsd) ? Math.max(0, costUsd) : 0,
      costReported,
    });
  }
  if (!data?.ok) {
    return NextResponse.json(
      { ok: false, error: "AI_QUERY_FAILED", detail: data?.error ?? null },
      { status: 422 },
    );
  }

  return NextResponse.json({
    ok: true,
    model: selected?.name ?? null,
    item_count: analysisItems.length,
    min_margin_pct: jobParams.min_margin_pct,
    flags: Array.isArray(data.data?.thin_margin_flags) ? data.data.thin_margin_flags : [],
    insights: typeof data.data?.insights === "string" ? data.data.insights : "",
  });
}
