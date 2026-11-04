import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { categories } from "@/db/schema";
import { getSession, getClientIp } from "@/lib/auth";
import { audit } from "@/lib/audit";

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  shortName: z.string().trim().min(1).max(10).optional(),
  taxRate: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  isTaxExempt: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { id } = await params;
  const [category] = await db.select().from(categories).where(and(eq(categories.id, id), eq(categories.isDeleted, false))).limit(1);
  if (!category) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, category });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.role !== "inventory") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = updateCategorySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(categories)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(categories.id, id), eq(categories.isDeleted, false)))
    .returning();

  if (!updated) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  await audit({
    entityType: "Category",
    entityId: id,
    action: "update",
    description: `Updated category: ${updated.name}`,
    oldValues: parsed.data,
    newValues: updated,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, category: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.role !== "inventory") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const [deleted] = await db
    .update(categories)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(and(eq(categories.id, id), eq(categories.isDeleted, false)))
    .returning();

  if (!deleted) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  await audit({
    entityType: "Category",
    entityId: id,
    action: "soft_delete",
    description: `Soft-deleted category: ${deleted.name}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true });
}
