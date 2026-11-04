import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { aiServiceAuthHeaders } from "@/lib/ai-service";

// POST /api/ai/forecast/train — retrain the demand forecaster with the
// latest dataset (KDD pipeline: refresh dataset_raw.csv → prepare → fit →
// evaluate → activate). Admin only: training replaces the model the whole
// branch is served with.
// GET /api/ai/forecast/train — training runs + the active model (read-only,
// admin + inventory) for the dashboard.

function aiServiceUrl(): string {
  return (process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.role !== "inventory") {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let upstream: Response;
  try {
    upstream = await fetch(`${aiServiceUrl()}/forecast/artifacts`, {
      headers: aiServiceAuthHeaders(),
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
  if (!upstream.ok || !data?.ok) {
    return NextResponse.json({ ok: false, error: "AI_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, ...data });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  let body: { branch_code?: string; branch_id?: string; collect?: boolean; activate?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const controller = new AbortController();
  // Training reads the dataset and grid-searches: give it room.
  const timeout = setTimeout(() => controller.abort(), 300_000);
  let upstream: Response;
  try {
    upstream = await fetch(`${aiServiceUrl()}/forecast/train`, {
      method: "POST",
      headers: aiServiceAuthHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        branch_code: body.branch_code ?? "",
        // Prefer the session's branch so the model is trained for the
        // exact branch the admin is logged into (serving then matches).
        branch_id: body.branch_id ?? session.user.branchId,
        collect: body.collect !== false,
        activate: body.activate !== false,
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
  if (!upstream.ok || !data) {
    return NextResponse.json({ ok: false, error: "AI_UNAVAILABLE" }, { status: 503 });
  }
  if (!data.ok) {
    return NextResponse.json(
      { ok: false, error: "AI_QUERY_FAILED", detail: data.error ?? null },
      { status: 422 },
    );
  }
  return NextResponse.json({ ok: true, ...data });
}
