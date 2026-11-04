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

// GET /api/ai/basket — market-basket relay (PROJECT_PLAN.md §8.11, §7.9).
// Session roles: admin + inventory (analysis is read-only). Draft saving is
// admin-only via POST /api/ai/basket/save. Forwards to the Python AI service
// (basket_build job: branch-scoped completed sales + association rules +
// draft bundle payloads — rule-based compute).
// Narration uses the DB-stored model credentials when a model is selected
// (explicit modelId, else the configured default); with no model configured
// it falls back to the AI service env/stub path (rule-based narration).

const querySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(90),
  min_support: z.coerce.number().int().min(2).max(100).default(2),
  discount_pct: z.coerce.number().min(1).max(90).default(10),
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
        job_type: "basket_build",
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
    rules: Array.isArray(data.data?.rules) ? data.data.rules : [],
    drafts: Array.isArray(data.data?.drafts) ? data.data.drafts : [],
    transaction_count:
      typeof data.data?.transaction_count === "number" ? data.data.transaction_count : 0,
    days: typeof data.data?.days === "number" ? data.data.days : jobParams.days,
    insights: typeof data.data?.insights === "string" ? data.data.insights : "",
  });
}
