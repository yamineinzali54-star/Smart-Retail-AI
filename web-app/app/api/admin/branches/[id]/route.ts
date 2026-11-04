import "server-only";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { branches, users } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const updateBranchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  cashDiscrepancyThreshold: z.string().optional(),
  roundingUnit: z.number().int().positive().optional(),
  registrationNo: z.string().max(50).nullable().optional(),
  taxInvoicePrefix: z.string().max(10).nullable().optional(),
  poApprovalThreshold: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .nullable()
    .optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { id } = await params;
  const [branch] = await db.select().from(branches).where(eq(branches.id, id)).limit(1);
  if (!branch) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, branch });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = updateBranchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(branches)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(branches.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  await audit({
    entityType: "Branch",
    entityId: id,
    action: "update",
    description: `Updated branch: ${updated.name}`,
    newValues: parsed.data,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, branch: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const [branch] = await db.select().from(branches).where(eq(branches.id, id)).limit(1);
  if (!branch) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  // Branches carry no is_deleted flag — block delete while staff reference it.
  const [inUse] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.branchId, id))
    .limit(1);
  if (inUse) {
    return NextResponse.json({ ok: false, error: "BRANCH_IN_USE" }, { status: 409 });
  }
  await db.delete(branches).where(eq(branches.id, id));

  await audit({
    entityType: "Branch",
    entityId: id,
    action: "delete",
    description: `Deleted branch: ${branch.name}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true });
}
