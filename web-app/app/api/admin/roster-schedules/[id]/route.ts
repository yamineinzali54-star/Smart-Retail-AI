import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { rosterSchedules } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const [schedule] = await db
    .select()
    .from(rosterSchedules)
    .where(and(eq(rosterSchedules.id, id), eq(rosterSchedules.branchId, session.user.branchId)))
    .limit(1);

  if (!schedule) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // Soft close: past dates still expand (history preserved), future stops.
  const end = schedule.endDate && schedule.endDate < todayUtc ? schedule.endDate : todayUtc;
  await db
    .update(rosterSchedules)
    .set({ isActive: false, endDate: end, updatedAt: now })
    .where(eq(rosterSchedules.id, id));

  await audit({
    entityType: "RosterSchedule",
    entityId: id,
    action: "soft_delete",
    description: `Closed schedule "${schedule.name}" (effective end ${end.toISOString().slice(0, 10)})`,
    oldValues: { name: schedule.name, endDate: schedule.endDate },
    newValues: { endDate: end, isActive: false },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true });
}
