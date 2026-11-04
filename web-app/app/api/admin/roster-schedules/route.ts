import "server-only";

import { NextResponse } from "next/server";
import { and, eq, or, isNull, lte, gte, desc, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { rosterSchedules, rosterScheduleEntries, users } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;

const createScheduleSchema = z.object({
  name: z.string().trim().min(1).max(150),
  startDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid date"),
  entries: z
    .array(
      z.object({
        userId: z.string().uuid(),
        plannedStart: z.string().regex(timeRe, "HH:MM expected"),
        plannedEnd: z.string().regex(timeRe, "HH:MM expected"),
        counterId: z.string().uuid().optional(),
        notes: z.string().max(255).optional(),
      }),
    )
    .min(1),
});

const DAY_MS = 86_400_000;

function prevDayUtc(d: Date): Date {
  return new Date(d.getTime() - DAY_MS);
}

export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: rosterSchedules.id,
      name: rosterSchedules.name,
      startDate: rosterSchedules.startDate,
      endDate: rosterSchedules.endDate,
      isActive: rosterSchedules.isActive,
      createdAt: rosterSchedules.createdAt,
    })
    .from(rosterSchedules)
    .where(eq(rosterSchedules.branchId, session.user.branchId))
    .orderBy(desc(rosterSchedules.startDate))
    .limit(100);

  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const schedules = rows.map((r) => {
    let status: string;
    if (!r.isActive || (r.endDate && r.endDate < todayUtc)) status = "ended";
    else if (r.startDate > todayUtc) status = "upcoming";
    else status = "active";
    return {
      id: r.id,
      name: r.name,
      startDate: r.startDate,
      endDate: r.endDate,
      status,
      createdAt: r.createdAt,
    };
  });

  return NextResponse.json({ ok: true, schedules });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createScheduleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { name, startDate, entries } = parsed.data;
  const start = new Date(startDate);

  const userIds = [...new Set(entries.map((e) => e.userId))];
  const foundUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, userIds), eq(users.branchId, session.user.branchId)));
  if (foundUsers.length !== userIds.length) {
    return NextResponse.json({ ok: false, error: "USER_NOT_FOUND" }, { status: 404 });
  }

  // Auto-supersede: close any active schedule whose window overlaps the new
  // start date — old endDate becomes (new start − 1 day).
  const overlapping = await db
    .select({ id: rosterSchedules.id })
    .from(rosterSchedules)
    .where(
      and(
        eq(rosterSchedules.branchId, session.user.branchId),
        eq(rosterSchedules.isActive, true),
        lte(rosterSchedules.startDate, start),
        or(isNull(rosterSchedules.endDate), gte(rosterSchedules.endDate, start)),
      ),
    );

  const newEnd = prevDayUtc(start);

  await db.transaction(async (tx) => {
    for (const old of overlapping) {
      await tx
        .update(rosterSchedules)
        .set({ endDate: newEnd, isActive: false, updatedAt: new Date() })
        .where(eq(rosterSchedules.id, old.id));
    }

    const [schedule] = await tx
      .insert(rosterSchedules)
      .values({
        branchId: session.user.branchId,
        name,
        startDate: start,
        endDate: null,
        isActive: true,
        createdBy: session.user.id,
      })
      .returning();

    await tx.insert(rosterScheduleEntries).values(
      entries.map((e) => ({
        scheduleId: schedule.id,
        userId: e.userId,
        plannedStart: e.plannedStart,
        plannedEnd: e.plannedEnd,
        counterId: e.counterId ?? null,
        notes: e.notes ?? null,
      })),
    );
  });

  await audit({
    entityType: "RosterSchedule",
    entityId: "new",
    action: "create",
    description: `Created schedule "${name}" effective ${startDate} (${entries.length} staff entries); superseded ${overlapping.length} schedule(s)`,
    newValues: { name, startDate, entryCount: entries.length },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
