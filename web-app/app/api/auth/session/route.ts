import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";

// GET /api/auth/session — current session (UI hydration + E2E).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, session });
}
