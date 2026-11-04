import "server-only";

import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { branches, userBranches, users } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const grantsSchema = z.object({
  branchIds: z.array(z.string().uuid()).min(1),
});

// Branch access grants for a staff member (admin only).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { id } = await params;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (!user) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  const grants = await db
    .select({
      branchId: userBranches.branchId,
      code: branches.code,
      name: branches.name,
    })
    .from(userBranches)
    .leftJoin(branches, eq(userBranches.branchId, branches.id))
    .where(eq(userBranches.userId, id));
  return NextResponse.json({ ok: true, branches: grants });
}

// Replace the grant set (home branch is always kept).
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { id } = await params;
  const parsed = grantsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const wanted = [...new Set([...parsed.data.branchIds, user.branchId])];
  const existing = await db
    .select({ id: branches.id })
    .from(branches)
    .where(inArray(branches.id, wanted));
  if (existing.length !== wanted.length) {
    return NextResponse.json({ ok: false, error: "BRANCH_NOT_FOUND" }, { status: 404 });
  }

  await db.transaction(async (tx) => {
    await tx.delete(userBranches).where(eq(userBranches.userId, id));
    await tx.insert(userBranches).values(wanted.map((branchId) => ({ userId: id, branchId })));
  });

  await audit({
    entityType: "User",
    entityId: id,
    action: "update",
    description: `Updated branch grants for staff: ${user.userName}`,
    newValues: { branchIds: wanted },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, branchIds: wanted });
}

