import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { aiServiceAuthHeaders } from "@/lib/ai-service";
import {
  getSelectableAiModels,
  recordAiModelUsage,
  reserveAiModel,
} from "@/lib/ai-model-settings";

// GET /api/ai/alerts — operations-alerts relay. Session roles: admin +
// inventory. Forwards to the Python AI service (ops_alerts job: dead stock,
// supplier price drift, void/discount abuse — rule-based compute).
// Narration uses the DB-stored model credentials when a model is selected
// (explicit modelId, else the configured default); with no model configured
// it falls back to the AI service env/stub path (rule-based narration).

const querySchema = z.object({
  dead_days: z.coerce.number().int().min(30).max(180).default(60),
  price_days: z.coerce.number().int().min(7).max(180).default(90),
  price_pct: z.coerce.number().min(1).max(100).default(5),
  sales_days: z.coerce.number().int().min(7).max(90).default(30),
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

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const { modelId, ...jobParams } = parsed.data;

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
        job_type: "ops_alerts",
        branch_id: session.user.branchId,
        params: { ...jobParams, narrate: true },
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
  if (!upstream.ok || !data) {
    return NextResponse.json({ ok: false, error: "AI_UNAVAILABLE" }, { status: 503 });
  }
  if (!data.ok) {
    return NextResponse.json(
      { ok: false, error: "AI_QUERY_FAILED", detail: data.error ?? null },
      { status: 422 },
    );
  }

  return NextResponse.json({
    ok: true,
    job_id: data.job_id ?? null,
    model: selected?.name ?? null,
    dead_stock: Array.isArray(data.data?.dead_stock) ? data.data.dead_stock : [],
    price_flags: Array.isArray(data.data?.price_flags) ? data.data.price_flags : [],
    abuse_flags: Array.isArray(data.data?.abuse_flags) ? data.data.abuse_flags : [],
    counts:
      data.data?.counts && typeof data.data.counts === "object"
        ? data.data.counts
        : { dead_stock: 0, price_flags: 0, abuse_flags: 0 },
    insights: typeof data.data?.insights === "string" ? data.data.insights : "",
  });
}
