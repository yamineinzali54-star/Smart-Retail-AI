import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { branches, userBranches, users } from "@/db/schema";
import {
  getClientIp,
  getSession,
  getUserAgent,
  issueSession,
  revokeAllUserSessions,
} from "@/lib/auth";
import { audit } from "@/lib/audit";

const switchSchema = z.object({
  branchId: z.string().uuid(),
});

// Switch the active branch: validates the grant, revokes every session of
// the user (so no stale-branch tokens survive), and issues a fresh pair
// scoped to the new branch.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const parsed = switchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { branchId } = parsed.data;
  if (branchId === session.user.branchId) {
    return NextResponse.json({ ok: true, switched: false, branchId });
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!user || !user.isActive) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const [grant] = await db
    .select({ userId: userBranches.userId })
    .from(userBranches)
    .where(and(eq(userBranches.userId, user.id), eq(userBranches.branchId, branchId)))
    .limit(1);
  const [target] = await db
    .select({ id: branches.id, code: branches.code, name: branches.name })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  if (!grant || !target) {
    return NextResponse.json({ ok: false, error: "BRANCH_NOT_ACCESSIBLE" }, { status: 403 });
  }

  await revokeAllUserSessions(user.id);
  const next = await issueSession(
    {
      id: user.id,
      userName: user.userName,
      role: user.role as typeof session.user.role,
      branchId: user.branchId,
    },
    {
      branchId: target.id,
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    },
  );

  await audit({
    entityType: "User",
    entityId: user.id,
    action: "update",
    description: `Switched active branch to ${target.code} (${target.name})`,
    userId: user.id,
    branchId: target.id,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({
    ok: true,
    switched: true,
    branchId: target.id,
    session: {
      user: next.user,
      expiresAt: next.expiresAt,
    },
  });
}
