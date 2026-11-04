import "server-only";

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import { getSession } from "@/lib/auth";

// In-memory store for link codes (use Redis in production)
const linkCodes = new Map<string, { code: string; expiresAt: number }>();

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const userId = session.user.id;
  const code = randomBytes(4).toString("hex").toUpperCase();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  linkCodes.set(userId, { code, expiresAt });

  return NextResponse.json({ ok: true, linkCode: code });
}
