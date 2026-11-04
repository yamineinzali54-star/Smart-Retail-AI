import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { aiServiceAuthHeaders } from "@/lib/ai-service";

function aiServiceUrl(): string {
  return (process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
}

function doneEvent(payload: unknown): string {
  return `event: done\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  let upstream: Response | null = null;
  try {
    upstream = await fetch(
      `${aiServiceUrl()}/revenue-forecast/train/stream?${new URLSearchParams({ branch_id: session.user.branchId })}`,
      {
        headers: aiServiceAuthHeaders({ accept: "text/event-stream" }),
        signal: controller.signal,
      },
    );
  } catch {
    upstream = null;
  }

  if (!upstream?.ok || !upstream.body) {
    clearTimeout(timeout);
    const error = upstream?.status === 429 ? "AI_QUOTA_EXCEEDED" : "AI_UNAVAILABLE";
    return new Response(doneEvent({ ok: false, error }), {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
      },
    });
  }

  const reader = upstream.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          clearTimeout(timeout);
          streamController.close();
          return;
        }
        streamController.enqueue(value);
      } catch {
        clearTimeout(timeout);
        streamController.error(new Error("Revenue training stream interrupted"));
      }
    },
    async cancel() {
      clearTimeout(timeout);
      await reader.cancel();
      controller.abort();
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
