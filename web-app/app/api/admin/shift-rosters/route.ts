import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { shiftRosters, users } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { expandRosters } from "@/lib/roster";

const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;

const createRosterSchema = z.object({
  userId: z.string().uuid(),
  rosterDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid date"),
  plannedStart: z.string().regex(timeRe, "HH:MM expected"),
  plannedEnd: z.string().regex(timeRe, "HH:MM expected"),
  counterId: z.string().uuid().optional(),
  notes: z.string().max(255).optional(),
});

const DAY_MS = 86_400_000;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  // Resolve the query window. Default: today → +6 days.
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let from: string;
  let to: string;
  if (date) {
    from = isoDay(new Date(date));
    to = from;
  } else if (fromParam && toParam) {
    from = isoDay(new Date(fromParam));
    to = isoDay(new Date(toParam));
  } else {
    from = isoDay(today);
    to = isoDay(new Date(today.getTime() + 6 * DAY_MS));
  }

  const rosters = await expandRosters(session.user.branchId, from, to);
  return NextResponse.json({ ok: true, rosters, from, to });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createRosterSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [user] = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(and(eq(users.id, parsed.data.userId), eq(users.branchId, session.user.branchId)))
    .limit(1);
  if (!user) {
    return NextResponse.json({ ok: false, error: "USER_NOT_FOUND" }, { status: 404 });
  }

  const [row] = await db
    .insert(shiftRosters)
    .values({
      branchId: session.user.branchId,
      userId: parsed.data.userId,
      rosterDate: new Date(parsed.data.rosterDate),
      plannedStart: parsed.data.plannedStart,
      plannedEnd: parsed.data.plannedEnd,
      counterId: parsed.data.counterId ?? null,
      notes: parsed.data.notes ?? null,
      createdBy: session.user.id,
    })
    .returning();

  await audit({
    entityType: "ShiftRoster",
    entityId: row.id,
    action: "create",
    description: `Rostered ${user.fullName} on ${parsed.data.rosterDate} (${parsed.data.plannedStart}–${parsed.data.plannedEnd})`,
    newValues: row,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, roster: row }, { status: 201 });
}
