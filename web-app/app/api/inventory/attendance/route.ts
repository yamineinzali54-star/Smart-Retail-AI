import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { staffAttendance } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== "inventory") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const [active] = await db
    .select({ id: staffAttendance.id, clockInAt: staffAttendance.clockInAt, branchId: staffAttendance.branchId })
    .from(staffAttendance)
    .where(
      and(
        eq(staffAttendance.userId, session.user.id),
        isNull(staffAttendance.clockOutAt),
      ),
    )
    .orderBy(desc(staffAttendance.clockInAt))
    .limit(1);

  return NextResponse.json({ ok: true, attendance: active ?? null });
}

export async function POST() {
  const session = await getSession();
  if (!session || session.user.role !== "inventory") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const [active] = await db
    .select({ id: staffAttendance.id })
    .from(staffAttendance)
    .where(
      and(
        eq(staffAttendance.userId, session.user.id),
        isNull(staffAttendance.clockOutAt),
      ),
    )
    .limit(1);
  if (active) {
    return NextResponse.json({ ok: false, error: "ATTENDANCE_ALREADY_ACTIVE" }, { status: 409 });
  }

  try {
    const [attendance] = await db
      .insert(staffAttendance)
      .values({ userId: session.user.id, branchId: session.user.branchId })
      .returning({ id: staffAttendance.id, clockInAt: staffAttendance.clockInAt });

    await audit({
      entityType: "StaffAttendance",
      entityId: attendance.id,
      action: "create",
      description: "Inventory staff started attendance",
      userId: session.user.id,
      branchId: session.user.branchId,
      ipAddress: await getClientIp(),
    });

    return NextResponse.json({ ok: true, attendance }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ ok: false, error: "ATTENDANCE_ALREADY_ACTIVE" }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE() {
  const session = await getSession();
  if (!session || session.user.role !== "inventory") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const [attendance] = await db
    .update(staffAttendance)
    .set({ clockOutAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(staffAttendance.userId, session.user.id),
        isNull(staffAttendance.clockOutAt),
      ),
    )
    .returning({
      id: staffAttendance.id,
      branchId: staffAttendance.branchId,
      clockInAt: staffAttendance.clockInAt,
      clockOutAt: staffAttendance.clockOutAt,
    });

  if (!attendance) {
    return NextResponse.json({ ok: false, error: "NO_ACTIVE_ATTENDANCE" }, { status: 409 });
  }

  await audit({
    entityType: "StaffAttendance",
    entityId: attendance.id,
    action: "update",
    description: "Inventory staff ended attendance",
    userId: session.user.id,
    branchId: attendance.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, attendance });
}
