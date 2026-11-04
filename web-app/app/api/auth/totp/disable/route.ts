import "server-only";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { comparePassword, getSession } from "@/lib/auth";

// POST /api/auth/totp/disable — turn off 2FA for the current user.
// Requires the account password (a stolen session alone must not be able
// to silently drop the second factor).
const disableSchema = z.object({
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  const parsed = disableSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!user || !(await comparePassword(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
  }
  await db
    .update(users)
    .set({ totpSecret: null, totpVerified: false })
    .where(eq(users.id, session.user.id));
  return NextResponse.json({ ok: true });
}
