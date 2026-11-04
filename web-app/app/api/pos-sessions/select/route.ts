import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import Decimal from "decimal.js";

import { db } from "@/db";
import { carts, counters, posSessions } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getActiveSession } from "@/lib/pos";

function posAccess(role: string): boolean {
  return role === "admin" || role === "cashier";
}

const openSessionSchema = z.object({
  counterId: z.string().uuid(),
  openingCash: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

// GET — restore active session, else list branch counters with occupancy.
export async function GET() {
  const session = await getSession();
  if (!session || !posAccess(session.user.role)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const active = await getActiveSession(session.user.id);
  if (active) {
    return NextResponse.json({ ok: true, restored: true, session: active });
  }

  const branchCounters = await db
    .select({ id: counters.id, name: counters.name, location: counters.location })
    .from(counters)
    .where(
      and(
        eq(counters.branchId, session.user.branchId),
        eq(counters.isActive, true),
        eq(counters.isDeleted, false),
      ),
    );
  const busy = await db
    .select({ counterId: posSessions.counterId })
    .from(posSessions)
    .where(
      and(
        eq(posSessions.branchId, session.user.branchId),
        eq(posSessions.status, "active"),
      ),
    );
  const busySet = new Set(busy.map((b) => b.counterId));

  return NextResponse.json({
    ok: true,
    restored: false,
    counters: branchCounters.map((c) => ({ ...c, inUse: busySet.has(c.id) })),
  });
}

// POST — open a session (§6.8 step 1, §4 R19 exclusivity in-transaction).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !posAccess(session.user.role)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = openSessionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (new Decimal(parsed.data.openingCash).lt(0)) {
    return NextResponse.json({ ok: false, error: "OPENING_CASH_NEGATIVE" }, { status: 400 });
  }

  const [counter] = await db
    .select()
    .from(counters)
    .where(
      and(
        eq(counters.id, parsed.data.counterId),
        eq(counters.branchId, session.user.branchId),
        eq(counters.isActive, true),
        eq(counters.isDeleted, false),
      ),
    )
    .limit(1);
  if (!counter) {
    return NextResponse.json({ ok: false, error: "COUNTER_NOT_FOUND" }, { status: 404 });
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [mine] = await tx
        .select({ id: posSessions.id })
        .from(posSessions)
        .where(
          and(eq(posSessions.userId, session.user.id), eq(posSessions.status, "active")),
        )
        .limit(1);
      if (mine) throw new Error("SESSION_ALREADY_ACTIVE");
      const [taken] = await tx
        .select({ id: posSessions.id })
        .from(posSessions)
        .where(
          and(
            eq(posSessions.counterId, parsed.data.counterId),
            eq(posSessions.status, "active"),
          ),
        )
        .limit(1);
      if (taken) throw new Error("COUNTER_IN_USE");
      const [row] = await tx
        .insert(posSessions)
        .values({
          userId: session.user.id,
          counterId: parsed.data.counterId,
          branchId: session.user.branchId,
          status: "active",
          openingCash: parsed.data.openingCash,
        })
        .returning();
      await tx.insert(carts).values({ posSessionId: row.id }).onConflictDoNothing();
      return row;
    });

    await audit({
      entityType: "POSSession",
      entityId: created.id,
      action: "create",
      description: `Opened POS session at ${counter.name}`,
      newValues: { counterId: counter.id, openingCash: parsed.data.openingCash },
      userId: session.user.id,
      branchId: session.user.branchId,
      ipAddress: await getClientIp(),
    });

    return NextResponse.json({ ok: true, session: created }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "SESSION_ALREADY_ACTIVE" || err.message === "COUNTER_IN_USE")) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 409 });
    }
    throw err;
  }
}
