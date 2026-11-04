import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  accessTokenTtlSeconds,
  getClientIp,
  getSession,
  getUserAgent,
  idleTimeoutSeconds,
  REFRESH_COOKIE,
  rotateSession,
} from "@/lib/auth";

// POST /api/auth/refresh — rotate the refresh token and re-issue the pair.
//
// - No rotation when the access token is still fresh (>10 min left):
//   returns { ok: true, refreshed: false } with zero DB writes.
// - Otherwise validates the refresh cookie, rotates (single-use), and sets
//   fresh cookies: { ok: true, refreshed: true, user }.
// - Missing/invalid/reused/expired refresh token → 401.
export async function POST() {
  const current = await getSession();
  if (current && current.expiresAt * 1000 - Date.now() > 10 * 60 * 1000) {
    return NextResponse.json({ ok: true, refreshed: false });
  }

  const store = await cookies();
  const presented = store.get(REFRESH_COOKIE)?.value;
  const result = await rotateSession(presented, {
    ipAddress: await getClientIp(),
    userAgent: await getUserAgent(),
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 401 },
    );
  }

  // Keep the TTL contract visible to the client scheduler.
  const res = NextResponse.json({
    ok: true,
    refreshed: true,
    user: {
      id: result.session.user.id,
      userName: result.session.user.userName,
      role: result.session.user.role,
      branchId: result.session.user.branchId,
    },
  });
  res.headers.set("x-access-ttl", String(accessTokenTtlSeconds()));
  res.headers.set("x-idle-ttl", String(idleTimeoutSeconds()));
  return res;
}
