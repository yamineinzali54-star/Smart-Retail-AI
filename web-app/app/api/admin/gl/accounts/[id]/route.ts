import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { glAccounts } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  isDeleted: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { id } = await params;

  const parsed = updateAccountSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select()
    .from(glAccounts)
    .where(and(eq(glAccounts.id, id), eq(glAccounts.isDeleted, false)))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const [updated] = await db
    .update(glAccounts)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(glAccounts.id, id), eq(glAccounts.isDeleted, false)))
    .returning();

  await audit({
    entityType: "GLAccount",
    entityId: id,
    action: "update",
    description: `Updated GL account ${existing.code}`,
    oldValues: { name: existing.name, isDeleted: existing.isDeleted },
    newValues: parsed.data,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, account: updated });
}
