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

// GET /api/ai/forecast — demand-forecast relay (PROJECT_PLAN.md §8.11
// /ai/demand-forecasting). Session roles: admin + inventory only. Forwards to the
// Python AI service (forecast_build job: branch-scoped sales history +
// moving-average demand + reorder suggestions + optional narration).
// Narration uses the DB-stored model credentials when a model is selected
// (explicit modelId, else the configured default); with no model configured
// it falls back to the AI service env/stub path (rule-based narration).

const querySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
  window: z.coerce.number().int().min(1).max(30).default(7),
  lead_time_days: z.coerce.number().int().min(0).max(60).default(7),
  safety_days: z.coerce.number().int().min(0).max(30).default(3),
  locale: z.enum(["en", "my"]).default("en"),
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
  // The AI service re-reads the branch history from a remote Postgres; a cold
  // database (or a training run in parallel) can make the job take well over
  // a minute, so the relay waits longer than the other AI relays.
  const timeout = setTimeout(() => controller.abort(), 180_000);
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
        job_type: "forecast_build",
        branch_id: session.user.branchId,
        params: jobParams,
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

  const forecasts = Array.isArray(data.data?.forecasts) ? data.data.forecasts.slice(0, 200) : [];
  return NextResponse.json({
    ok: true,
    job_id: data.job_id ?? null,
    // The LLM used for the narration (or null when the service fell back to
    // the offline stub).
    llm_model: selected?.name ?? null,
    // Which estimator produced avg_daily_sales: "seasonal_model" when a
    // trained forecasting model is active, otherwise "moving_average".
    forecast_source:
      typeof data.data?.forecast_source === "string" ? data.data.forecast_source : "moving_average",
    // Metadata of the trained demand model (not the LLM).
    forecast_model:
      data.data?.model && typeof data.data.model === "object" ? data.data.model : null,
    forecasts,
    product_count:
      typeof data.data?.product_count === "number" ? data.data.product_count : forecasts.length,
    need_order_count:
      typeof data.data?.need_order_count === "number" ? data.data.need_order_count : 0,
    total_suggested_units:
      typeof data.data?.total_suggested_units === "number" ? data.data.total_suggested_units : 0,
    truncated: Boolean(data.data?.truncated),
    days: typeof data.data?.days === "number" ? data.data.days : jobParams.days,
    insights: typeof data.data?.insights === "string" ? data.data.insights : "",
  });
}
