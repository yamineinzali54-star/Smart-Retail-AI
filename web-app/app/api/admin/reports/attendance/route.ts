import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gte, lt } from "drizzle-orm";

import { db } from "@/db";
import { posSessions, staffAttendance } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getPaginationParams, paginateArray } from "@/lib/pagination";
import { expandRosters } from "@/lib/roster";

const GRACE_MINUTES = 15;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Attendance: planned roster vs actual POS sessions and inventory clock-ins per user per day.
// Present = a session started within planned start + grace; late and
// absent derive from the same comparison. Computed on demand. Planned shifts
// come from expandRosters (effective-dated schedules + quick-add overrides).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams;
  const { page, pageSize } = getPaginationParams(q);
  const startParam = q.get("startDate");
  const endParam = q.get("endDate");
  const end = endParam ? new Date(endParam) : new Date();
  const start = startParam ? new Date(startParam) : new Date(end.getTime() - 6 * 86_400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ ok: false, error: "INVALID_DATE" }, { status: 400 });
  }
  const branchId = q.get("branchId") ?? session.user.branchId;

  const rosters = await expandRosters(branchId, isoDay(start), isoDay(end));

  const sessions = await db
    .select({
      userId: posSessions.userId,
      startTime: posSessions.startTime,
      endTime: posSessions.endTime,
    })
    .from(posSessions)
    .where(
      and(
        eq(posSessions.branchId, branchId),
        gte(posSessions.startTime, start),
        lt(posSessions.startTime, new Date(end.getTime() + 86_400_000)),
      ),
    );

  const inventoryAttendance = await db
    .select({
      userId: staffAttendance.userId,
      startTime: staffAttendance.clockInAt,
      endTime: staffAttendance.clockOutAt,
    })
    .from(staffAttendance)
    .where(
      and(
        eq(staffAttendance.branchId, branchId),
        gte(staffAttendance.clockInAt, start),
        lt(staffAttendance.clockInAt, new Date(end.getTime() + 86_400_000)),
      ),
    );

  const byUserDay = new Map<string, { start: Date; end: Date | null }[]>();
  for (const s of [...sessions, ...inventoryAttendance]) {
    const day = new Date(s.startTime).toISOString().slice(0, 10);
    const key = `${s.userId}|${day}`;
    const list = byUserDay.get(key) ?? [];
    list.push({ start: new Date(s.startTime), end: s.endTime ? new Date(s.endTime) : null });
    byUserDay.set(key, list);
  }

  const rows = rosters.map((r) => {
    const day = r.rosterDate; // already YYYY-MM-DD from expandRosters
    const daySessions = byUserDay.get(`${r.userId}|${day}`) ?? [];
    const [ph, pm] = r.plannedStart.split(":").map(Number);
    const planned = new Date(`${day}T${String(ph).padStart(2, "0")}:${String(pm).padStart(2, "0")}:00`);
    const firstIn = daySessions.length > 0
      ? new Date(Math.min(...daySessions.map((s) => s.start.getTime())))
      : null;
    const lateMin = firstIn ? Math.round((firstIn.getTime() - planned.getTime()) / 60000) : null;
    const status = !firstIn ? "absent" : (lateMin ?? 0) > GRACE_MINUTES ? "late" : "present";
    const workedMin = daySessions.reduce((sum, s) => {
      const endT = s.end ?? new Date();
      return sum + Math.max(0, Math.round((endT.getTime() - s.start.getTime()) / 60000));
    }, 0);
    return {
      rosterId: r.id,
      userId: r.userId,
      userName: r.userName,
      date: day,
      planned: `${r.plannedStart}–${r.plannedEnd}`,
      status,
      lateMinutes: lateMin != null && lateMin > 0 ? lateMin : 0,
      sessions: daySessions.length,
      workedMinutes: workedMin,
      firstIn: firstIn?.toISOString() ?? null,
    };
  });

  const summary = {
    present: rows.filter((r) => r.status === "present").length,
    late: rows.filter((r) => r.status === "late").length,
    absent: rows.filter((r) => r.status === "absent").length,
  };

  const result = paginateArray(rows, page, pageSize);
  return NextResponse.json({ ok: true, attendance: result.items, summary, ...result.pagination });
}
