import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { units } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const updateUnitSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  shortName: z.string().trim().min(1).max(10).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const [unit] = await db
    .select()
    .from(units)
    .where(and(eq(units.id, id), eq(units.isDeleted, false)))
    .limit(1);

  if (!unit) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, unit });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = updateUnitSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const [unit] = await db
    .select()
    .from(units)
    .where(and(eq(units.id, id), eq(units.isDeleted, false)))
    .limit(1);

  if (!unit) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const [updated] = await db
    .update(units)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(units.id, id), eq(units.isDeleted, false)))
    .returning();

  await audit({
    entityType: "Unit",
    entityId: id,
    action: "update",
    description: `Updated unit: ${unit.name}`,
    oldValues: { name: unit.name, shortName: unit.shortName },
    newValues: parsed.data,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: null,
  });

  return NextResponse.json({ ok: true, unit: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const [unit] = await db
    .select()
    .from(units)
    .where(and(eq(units.id, id), eq(units.isDeleted, false)))
    .limit(1);

  if (!unit) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const [updated] = await db
    .update(units)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(eq(units.id, id))
    .returning();

  await audit({
    entityType: "Unit",
    entityId: id,
    action: "soft_delete",
    description: `Soft-deleted unit: ${unit.name}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: null,
  });

  return NextResponse.json({ ok: true, unit: updated });
}
