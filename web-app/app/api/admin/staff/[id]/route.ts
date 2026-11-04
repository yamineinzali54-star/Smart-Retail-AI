import "server-only";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession, getClientIp } from "@/lib/auth";
import { audit } from "@/lib/audit";

const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(100).optional(),
  role: z.enum(["admin", "inventory", "cashier"]).optional(),
  branchId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(100).optional(),
  // Cashier fast-PIN (4–6 digits); null clears it. Stored bcrypt-hashed.
  pin: z.string().regex(/^\d{4,6}$/).nullable().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { id } = await params;
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, user });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { id } = await params;
  const parsed = updateUserSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() }, { status: 400 });
  }
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  const updates: Partial<typeof users.$inferInsert> = {};
  if (parsed.data.fullName !== undefined) updates.fullName = parsed.data.fullName;
  if (parsed.data.role !== undefined) updates.role = parsed.data.role;
  if (parsed.data.branchId !== undefined) updates.branchId = parsed.data.branchId;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.password !== undefined) {
    const { hash } = await import("bcryptjs");
    updates.passwordHash = await hash(parsed.data.password, 10);
  }
  if (parsed.data.pin !== undefined) {
    if (parsed.data.pin !== null && user.role !== "cashier" && parsed.data.role !== "cashier") {
      return NextResponse.json({ ok: false, error: "PIN_CASHER_ONLY" }, { status: 400 });
    }
    if (parsed.data.pin === null) {
      updates.pinHash = null;
    } else {
      const { hash } = await import("bcryptjs");
      updates.pinHash = await hash(parsed.data.pin, 10);
    }
  }
  const [updated] = await db.update(users).set(updates).where(eq(users.id, id)).returning({ id: users.id, userName: users.userName, fullName: users.fullName, role: users.role, branchId: users.branchId, isActive: users.isActive });
  await audit({
    entityType: "User",
    entityId: id,
    action: "update",
    description: `Updated staff: ${user.userName}`,
    oldValues: { fullName: user.fullName, role: user.role, isActive: user.isActive },
    newValues: updates,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });
  return NextResponse.json({ ok: true, user: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { id } = await params;
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  await db.update(users).set({ isActive: false }).where(eq(users.id, id));
  await audit({
    entityType: "User",
    entityId: id,
    action: "soft_delete",
    description: `Deactivated staff: ${user.userName}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });
  return NextResponse.json({ ok: true });
}
