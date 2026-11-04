import "server-only";

import { and, eq, gte, lte, or, isNull } from "drizzle-orm";

import { db } from "@/db";
import { counters, rosterSchedules, rosterScheduleEntries, shiftRosters, users } from "@/db/schema";

export interface ExpandedRosterRow {
  id: string;
  userId: string;
  userName: string | null;
  rosterDate: string; // YYYY-MM-DD (UTC civil date)
  plannedStart: string;
  plannedEnd: string;
  counterId: string | null;
  counterName: string | null;
  notes: string | null;
  source: "schedule" | "quick_add";
  scheduleId: string | null;
  scheduleName: string | null;
}

const DAY_MS = 86_400_000;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysUtc(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/**
 * Expand effective roster rows for [from, to] (inclusive, YYYY-MM-DD).
 *
 * - Ad-hoc `shift_roster` rows (quick add) always appear.
 * - Active roster_schedule entries apply every day within their window.
 * - When both exist for (user, date), the ad-hoc row wins (override).
 */
export async function expandRosters(
  branchId: string,
  from: string,
  to: string,
): Promise<ExpandedRosterRow[]> {
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || toDate < fromDate) {
    return [];
  }

  // Guard against unbounded ranges (a forgotten end date).
  const maxDays = 366;
  const dayCount = Math.min(
    maxDays,
    Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1,
  );

  // --- Ad-hoc rows (quick add) ---
  const adHoc = await db
    .select({
      id: shiftRosters.id,
      userId: shiftRosters.userId,
      userName: users.fullName,
      rosterDate: shiftRosters.rosterDate,
      plannedStart: shiftRosters.plannedStart,
      plannedEnd: shiftRosters.plannedEnd,
      counterId: shiftRosters.counterId,
      counterName: counters.name,
      notes: shiftRosters.notes,
    })
    .from(shiftRosters)
    .leftJoin(users, eq(shiftRosters.userId, users.id))
    .leftJoin(counters, and(eq(shiftRosters.counterId, counters.id), eq(counters.isDeleted, false)))
    .where(
      and(
        eq(shiftRosters.branchId, branchId),
        gte(shiftRosters.rosterDate, fromDate),
        lte(shiftRosters.rosterDate, toDate),
      ),
    );

  const rows: ExpandedRosterRow[] = adHoc.map((r) => ({
    id: r.id,
    userId: r.userId,
    userName: r.userName,
    rosterDate: isoDay(r.rosterDate),
    plannedStart: r.plannedStart,
    plannedEnd: r.plannedEnd,
    counterId: r.counterId,
    counterName: r.counterName,
    notes: r.notes,
    source: "quick_add",
    scheduleId: null,
    scheduleName: null,
  }));

  const adHocKey = new Set(rows.map((r) => `${r.userId}|${r.rosterDate}`));

  // --- Schedules overlapping [from, to] ---
  const schedules = await db
    .select({
      id: rosterSchedules.id,
      name: rosterSchedules.name,
      startDate: rosterSchedules.startDate,
      endDate: rosterSchedules.endDate,
    })
    .from(rosterSchedules)
    .where(
      and(
        eq(rosterSchedules.branchId, branchId),
        eq(rosterSchedules.isActive, true),
        lte(rosterSchedules.startDate, toDate),
        or(isNull(rosterSchedules.endDate), gte(rosterSchedules.endDate, fromDate)),
      ),
    );

  if (schedules.length === 0) return rows;

  const scheduleIds = schedules.map((s) => s.id);
  const entries = await db
    .select({
      id: rosterScheduleEntries.id,
      scheduleId: rosterScheduleEntries.scheduleId,
      userId: rosterScheduleEntries.userId,
      userName: users.fullName,
      plannedStart: rosterScheduleEntries.plannedStart,
      plannedEnd: rosterScheduleEntries.plannedEnd,
      counterId: rosterScheduleEntries.counterId,
      counterName: counters.name,
      notes: rosterScheduleEntries.notes,
    })
    .from(rosterScheduleEntries)
    .leftJoin(users, eq(rosterScheduleEntries.userId, users.id))
    .leftJoin(
      counters,
      and(eq(rosterScheduleEntries.counterId, counters.id), eq(counters.isDeleted, false)),
    );

  const entriesBySchedule = new Map<string, typeof entries>();
  for (const e of entries) {
    if (!scheduleIds.includes(e.scheduleId)) continue;
    const list = entriesBySchedule.get(e.scheduleId) ?? [];
    list.push(e);
    entriesBySchedule.set(e.scheduleId, list);
  }

  // Expand day-by-day within each schedule window ∩ [from, to].
  for (const schedule of schedules) {
    const windowStart = schedule.startDate > fromDate ? schedule.startDate : fromDate;
    const windowEnd =
      schedule.endDate && schedule.endDate < toDate ? schedule.endDate : toDate;
    const schedEntries = entriesBySchedule.get(schedule.id) ?? [];
    if (schedEntries.length === 0) continue;

    for (let i = 0; i < dayCount; i++) {
      const dayDate = addDaysUtc(fromDate, i);
      if (dayDate > windowEnd) break;
      if (dayDate < windowStart) continue;
      const day = isoDay(dayDate);

      for (const e of schedEntries) {
        const key = `${e.userId}|${day}`;
        if (adHocKey.has(key)) continue; // ad-hoc override wins
        rows.push({
          id: `sched:${schedule.id}:${e.id}:${day}`,
          userId: e.userId,
          userName: e.userName,
          rosterDate: day,
          plannedStart: e.plannedStart,
          plannedEnd: e.plannedEnd,
          counterId: e.counterId,
          counterName: e.counterName,
          notes: e.notes,
          source: "schedule",
          scheduleId: schedule.id,
          scheduleName: schedule.name,
        });
      }
    }
  }

  rows.sort((a, b) => (a.rosterDate === b.rosterDate ? (a.userName ?? "").localeCompare(b.userName ?? "") : a.rosterDate.localeCompare(b.rosterDate)));
  return rows;
}
