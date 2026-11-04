import "server-only";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { buildOtpAuthUrl, generateTotpSecret } from "@/lib/totp";

// POST /api/auth/totp/setup — start (or restart) 2FA enrollment for the
// current user. Stores a fresh secret as UNVERIFIED and returns the
// otpauth:// URL for the authenticator app. Nothing is enforced until
// POST /api/auth/totp/confirm succeeds with a fresh code.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  const secret = generateTotpSecret();
  await db
    .update(users)
    .set({ totpSecret: secret, totpVerified: false })
    .where(eq(users.id, session.user.id));
  return NextResponse.json({
    ok: true,
    otpAuthUrl: buildOtpAuthUrl(session.user.userName, secret),
  });
}
