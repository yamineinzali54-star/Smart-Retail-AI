import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getActiveSession } from "@/lib/pos";

export async function GET() {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const active = await getActiveSession(session.user.id);
  if (!active) {
    return NextResponse.json({ ok: false, error: "NO_ACTIVE_SESSION" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, session: active });
}
