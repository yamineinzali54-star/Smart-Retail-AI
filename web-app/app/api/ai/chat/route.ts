import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { aiServiceAuthHeaders } from "@/lib/ai-service";
import { recordAiModelUsage, reserveAiModel } from "@/lib/ai-model-settings";

// POST /api/ai/chat — RAG relay (PROJECT_PLAN.md §7.17). Session roles:
// admin + inventory only. Forwards the question to the Python AI service
// (rag_answer job) and returns the narrated answer + guarded SQL + rows.
// A down AI service degrades to 503 here only — POS checkout never touches
// this route, so an AI outage can never block sales.

const chatSchema = z.object({
  question: z.string().trim().min(1).max(500),
  modelId: z.string().uuid(),
});

function aiServiceUrl(): string {
  return (process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.role !== "inventory") {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const parsed = chatSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const reservation = await reserveAiModel(parsed.data.modelId);
  if (!reservation.ok) {
    return NextResponse.json({ ok: false, error: reservation.error }, { status: 429 });
  }
  const selectedModel = reservation.model;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  let upstream: Response;
  try {
    const headers = new Headers({ "content-type": "application/json" });
    headers.set("x-ai-model-provider", selectedModel.provider);
    headers.set("x-ai-model", selectedModel.name);
    headers.set("x-ai-api-key", selectedModel.apiKey);
    if (selectedModel.providerMaxOutputTokens) headers.set("x-ai-max-tokens", String(selectedModel.providerMaxOutputTokens));
    upstream = await fetch(`${aiServiceUrl()}/jobs/enqueue`, {
      method: "POST",
      headers: aiServiceAuthHeaders(headers),
      body: JSON.stringify({
        job_type: "rag_answer",
        branch_id: session.user.branchId,
        params: { question: parsed.data.question },
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
  if (Number.isFinite(totalTokens) && totalTokens >= 0) {
    await recordAiModelUsage(selectedModel.id, {
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

  const rows = Array.isArray(data.data?.rows) ? data.data.rows.slice(0, 50) : [];
  return NextResponse.json({
    ok: true,
    job_id: data.job_id ?? null,
    answer: typeof data.data?.answer === "string" ? data.data.answer : "",
    understanding:
      typeof data.data?.understanding === "string" ? data.data.understanding : "",
    plan: Array.isArray(data.data?.plan) ? data.data.plan : [],
    findings: Array.isArray(data.data?.findings) ? data.data.findings : [],
    summary: typeof data.data?.summary === "string" ? data.data.summary : "",
    suggestions: Array.isArray(data.data?.suggestions) ? data.data.suggestions : [],
    sql: typeof data.data?.sql === "string" ? data.data.sql : "",
    rows,
    row_count: typeof data.data?.row_count === "number" ? data.data.row_count : rows.length,
    truncated: Boolean(data.data?.truncated),
  });
}
