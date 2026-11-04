import "server-only";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import {
  comparePassword,
  getClientIp,
  getUserAgent,
  issueSession,
  type SessionRole,
} from "@/lib/auth";
import { audit } from "@/lib/audit";
import {
  clearLoginFailures,
  isLoginBlocked,
  recordLoginFailure,
} from "@/lib/rate-limit";
import { verifyTotpCode } from "@/lib/totp";

const loginSchema = z.object({
  userName: z.string().trim().min(1).max(50),
  // Either a password or a cashier fast-PIN (4–6 digits, cashier role only).
  password: z.string().min(1).max(200).optional(),
  pin: z.string().regex(/^\d{4,6}$/).optional(),
  totpCode: z.string().trim().max(10).optional(),
}).refine((v) => v.password !== undefined || v.pin !== undefined, {
  message: "password or pin required",
});

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

// POST /api/auth/login — { userName, password, totpCode? } (§7.1)
//
// 2FA is strictly opt-in (enabled from /settings/security). Login is
// credentials-first: if the user enrolled AND verified TOTP, a missing code
// yields 401 TOTP_REQUIRED (password was valid — not counted as a failure);
// a wrong code is INVALID_CREDENTIALS like any other bad credential.
export async function POST(req: Request) {
  const parsed = loginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail(400, "VALIDATION_ERROR", { issues: parsed.error.flatten() });
  }
  const { userName, password, pin, totpCode } = parsed.data;
  const ip = await getClientIp();
  // Two buckets per attempt: "<user>|<ip>" throttles brute force on one
  // account from one source; "ip:<ip>" (higher ceiling) throttles credential
  // spraying across usernames. Keying only by username let anyone lock a
  // known account (e.g. seed "inventory1") for every legitimate user.
  const userLimitKey = `${userName.toLowerCase()}|${ip}`;
  const ipLimitKey = `ip:${ip}`;
  const IP_MAX_FAILS = 20;

  if (
    (await isLoginBlocked(userLimitKey)) ||
    (await isLoginBlocked(ipLimitKey, IP_MAX_FAILS))
  ) {
    return fail(429, "TOO_MANY_ATTEMPTS");
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.userName, userName))
    .limit(1);

  const invalid = async () => {
    await recordLoginFailure(userLimitKey);
    await recordLoginFailure(ipLimitKey, IP_MAX_FAILS);
    await audit({
      entityType: "Auth",
      entityId: userName,
      action: "login_failed",
      description: "Failed login attempt",
      userId: user?.id ?? null,
      branchId: user?.branchId ?? null,
      ipAddress: ip,
    });
    return fail(401, "INVALID_CREDENTIALS");
  };

  if (!user || !user.isActive) return invalid();
  if (pin !== undefined) {
    // Fast terminal PIN — cashier role only, never for admin/inventory.
    if (user.role !== "cashier" || !user.pinHash) return invalid();
    if (!(await comparePassword(pin, user.pinHash))) return invalid();
  } else {
    if (!(await comparePassword(password!, user.passwordHash))) return invalid();
  }

  // Enforced only when the user completed enrollment in Settings.
  // An abandoned setup (secret stored, never verified) does not lock out.
  if (user.totpSecret && user.totpVerified) {
    if (!totpCode) return fail(401, "TOTP_REQUIRED");
    if (!(await verifyTotpCode(user.totpSecret, totpCode))) return invalid();
  }

  await clearLoginFailures(userLimitKey);
  await clearLoginFailures(ipLimitKey);

  // Issues auth_session row + access (1h) + refresh (7d) cookies.
  await issueSession(
    {
      id: user.id,
      userName: user.userName,
      role: user.role as SessionRole,
      branchId: user.branchId,
    },
    { ipAddress: ip, userAgent: await getUserAgent() },
  );

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      userName: user.userName,
      fullName: user.fullName,
      role: user.role,
      branchId: user.branchId,
    },
  });
}
