import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { aiServiceAuthHeaders } from "@/lib/ai-service";

function aiServiceUrl(): string {
  return (process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
}

async function relay(path: string, method: "GET" | "POST", branchId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), method === "POST" ? 300_000 : 60_000);
  try {
    const upstream = await fetch(
      `${aiServiceUrl()}${path}?${new URLSearchParams({ branch_id: branchId })}`,
      {
        method,
        headers: aiServiceAuthHeaders(),
        signal: controller.signal,
      },
    );
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok || !data) {
      return NextResponse.json(
      { ok: false, error: data?.detail ?? "AI_UNAVAILABLE" },
        { status: upstream.status || 503 },
      );
    }
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json({ ok: false, error: "AI_UNAVAILABLE" }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.role !== "inventory") {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }
  return relay("/revenue-forecast", "GET", session.user.branchId);
}

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }
  return relay("/revenue-forecast/train", "POST", session.user.branchId);
}
