import "server-only";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { verifyTotpCode } from "@/lib/totp";

const confirmSchema = z.object({
  totpCode: z.string().trim().min(6).max(10),
});

// POST /api/auth/totp/confirm — complete TOTP enrollment after a first login
// that provisioned the secret (marks totp_verified).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  const parsed = confirmSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!user?.totpSecret) {
    return NextResponse.json({ ok: false, error: "TOTP_NOT_ENROLLED" }, { status: 409 });
  }
  if (!(await verifyTotpCode(user.totpSecret, parsed.data.totpCode))) {
    return NextResponse.json({ ok: false, error: "INVALID_TOTP" }, { status: 401 });
  }
  await db
    .update(users)
    .set({ totpVerified: true })
    .where(eq(users.id, user.id));
  return NextResponse.json({ ok: true });
}
