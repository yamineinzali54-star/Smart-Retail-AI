import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { aiServiceAuthHeaders } from "@/lib/ai-service";

// GET /api/ai/forecast/artifacts/[runId]/dataset — download the CSV
// dataset a training run was built from (kind=prepared default, kind=raw
// for the untouched database export). Admin + inventory.

function aiServiceUrl(): string {
  return (process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.role !== "inventory") {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const { runId } = await params;
  if (!/^[A-Za-z0-9_\-]{1,64}$/.test(runId)) {
    return NextResponse.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const kind = new URL(req.url).searchParams.get("kind") === "raw" ? "raw" : "prepared";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let upstream: Response;
  try {
    upstream = await fetch(
      `${aiServiceUrl()}/forecast/artifacts/${encodeURIComponent(runId)}/dataset?kind=${kind}`,
      { headers: aiServiceAuthHeaders(), signal: controller.signal },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "AI_UNAVAILABLE" }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { ok: false, error: upstream.status === 404 ? "NOT_FOUND" : "AI_UNAVAILABLE" },
      { status: upstream.status === 404 ? 404 : 503 },
    );
  }
  const body = await upstream.arrayBuffer();
  const disposition =
    upstream.headers.get("content-disposition") ??
    `attachment; filename="dataset_${kind}.csv"`;
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": disposition,
    },
  });
}
