import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { counters } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const updateCounterSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  location: z.string().max(100).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { id } = await params;
  const [counter] = await db.select().from(counters).where(and(eq(counters.id, id), eq(counters.isDeleted, false))).limit(1);
  if (!counter) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, counter });
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
  const parsed = updateCounterSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(counters)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(counters.id, id), eq(counters.isDeleted, false)))
    .returning();

  if (!updated) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  await audit({
    entityType: "Counter",
    entityId: id,
    action: "update",
    description: `Updated counter: ${updated.name}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: null,
  });

  return NextResponse.json({ ok: true, counter: updated });
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
  const [deleted] = await db
    .update(counters)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(and(eq(counters.id, id), eq(counters.isDeleted, false)))
    .returning();

  if (!deleted) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  await audit({
    entityType: "Counter",
    entityId: id,
    action: "soft_delete",
    description: `Soft-deleted counter: ${deleted.name}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: null,
  });

  return NextResponse.json({ ok: true });
}
