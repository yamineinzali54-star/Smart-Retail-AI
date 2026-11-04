import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { aiServiceAuthHeaders } from "@/lib/ai-service";

// GET /api/ai/forecast/train/stream — SSE relay for the forecasting
// training run. The Python service emits one `status` event per pipeline
// step (collect → load → split → grid search → evaluate) and a terminal
// `done` event with the model + metrics, so the dashboard can show the
// training progress live. Admin only.

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

function doneEvent(payload: unknown): string {
  return `event: done\ndata: ${JSON.stringify(payload)}\n\n`;
}

function aiServiceUrl(): string {
  return (process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const controller = new AbortController();
  // The whole pipeline (collect → prepare → grid search → evaluate) runs in
  // one request, so the timeout is generous.
  const timeout = setTimeout(() => controller.abort(), 300_000);
  let upstream: Response | null = null;
  try {
    const url =
      `${aiServiceUrl()}/stream/forecast_train?` +
      new URLSearchParams({
        branch_code: params.get("branch_code") ?? "",
        // Pass the session's branch so the model is trained for the exact
        // branch the admin is logged into — the serving job then matches.
        branch_id: session.user.branchId,
      });
    upstream = await fetch(url, {
      headers: aiServiceAuthHeaders({ accept: "text/event-stream" }),
      signal: controller.signal,
    });
  } catch {
    upstream = null;
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream || !upstream.ok || !upstream.body) {
    const error = upstream?.status === 429 ? "AI_QUOTA_EXCEEDED" : "AI_UNAVAILABLE";
    return new Response(doneEvent({ ok: false, error }), { headers: SSE_HEADERS });
  }
  return new Response(upstream.body, { headers: SSE_HEADERS });
}
