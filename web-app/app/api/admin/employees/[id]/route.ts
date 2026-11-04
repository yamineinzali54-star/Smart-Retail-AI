import "server-only";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const updateEmployeeSchema = z.object({
  fullName: z.string().trim().min(1).max(100).optional(),
  email: z.string().email().max(150).optional().nullable(),
  role: z.enum(["inventory", "cashier"]).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const [employee] = await db
    .select({
      id: users.id,
      userName: users.userName,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!employee) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, employee });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = updateEmployeeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const [employee] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!employee) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const updates: Partial<typeof users.$inferInsert> = {};
  if (parsed.data.fullName !== undefined) updates.fullName = parsed.data.fullName;
  if (parsed.data.email !== undefined) updates.email = parsed.data.email;
  if (parsed.data.role !== undefined) updates.role = parsed.data.role;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;

  const [updated] = await db
    .update(users)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({
      id: users.id,
      userName: users.userName,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
    });

  await audit({
    entityType: "User",
    entityId: id,
    action: "update",
    description: `Updated employee: ${employee.userName}`,
    oldValues: { fullName: employee.fullName, email: employee.email, role: employee.role, isActive: employee.isActive },
    newValues: updates,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: null,
  });

  return NextResponse.json({ ok: true, employee: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;

  if (id === session.user.id) {
    return NextResponse.json({ ok: false, error: "CANNOT_DEACTIVATE_SELF" }, { status: 400 });
  }

  const [employee] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!employee) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const [updated] = await db
    .update(users)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({
      id: users.id,
      userName: users.userName,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
    });

  await audit({
    entityType: "User",
    entityId: id,
    action: "soft_delete",
    description: `Deactivated employee: ${employee.userName}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: null,
  });

  return NextResponse.json({ ok: true, employee: updated });
}
