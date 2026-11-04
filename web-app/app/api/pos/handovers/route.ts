import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import Decimal from "decimal.js";

import { db } from "@/db";
import { sales, shiftHandovers, users } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getActiveSession } from "@/lib/pos";

const handoverSchema = z.object({
  blindCount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  incomingUserId: z.string().uuid().optional(),
  notes: z.string().max(255).optional(),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 100));

  const conditions = [eq(shiftHandovers.branchId, session.user.branchId)];
  if (session.user.role === "cashier") {
    conditions.push(eq(shiftHandovers.outgoingUserId, session.user.id));
  }

  const rows = await db
    .select({
      id: shiftHandovers.id,
      outgoingName: users.fullName,
      expectedCash: shiftHandovers.expectedCash,
      blindCount: shiftHandovers.blindCount,
      difference: shiftHandovers.difference,
      notes: shiftHandovers.notes,
      handedAt: shiftHandovers.handedAt,
    })
    .from(shiftHandovers)
    .leftJoin(users, eq(shiftHandovers.outgoingUserId, users.id))
    .where(and(...conditions))
    .orderBy(desc(shiftHandovers.handedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, handovers: rows, page, pageSize });
}

// Record a mid-day handover: blind-counted cash vs session-expected cash.
// The session stays open — the next cashier continues on the same till.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = handoverSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const active = await getActiveSession(session.user.id);
  if (!active || active.branchId !== session.user.branchId) {
    return NextResponse.json({ ok: false, error: "NO_ACTIVE_SESSION" }, { status: 409 });
  }

  let incomingId: string | null = null;
  if (parsed.data.incomingUserId) {
    const [incoming] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, parsed.data.incomingUserId),
          eq(users.branchId, session.user.branchId),
          eq(users.isActive, true),
        ),
      )
      .limit(1);
    if (!incoming) {
      return NextResponse.json({ ok: false, error: "INCOMING_USER_NOT_FOUND" }, { status: 404 });
    }
    incomingId = incoming.id;
  }

  const cashSales = await db
    .select({ grandTotal: sales.grandTotal })
    .from(sales)
    .where(
      and(
        eq(sales.posSessionId, active.id),
        eq(sales.status, "completed"),
        eq(sales.paymentMethod, "cash"),
      ),
    );
  const expected = cashSales
    .reduce((s, r) => s.plus(r.grandTotal), new Decimal(active.openingCash ?? "0"))
    .toFixed(2);
  const difference = new Decimal(parsed.data.blindCount).minus(expected).toFixed(2);

  const [handover] = await db
    .insert(shiftHandovers)
    .values({
      branchId: session.user.branchId,
      posSessionId: active.id,
      outgoingUserId: session.user.id,
      incomingUserId: incomingId,
      expectedCash: expected,
      blindCount: new Decimal(parsed.data.blindCount).toFixed(2),
      difference,
      notes: parsed.data.notes ?? null,
      createdBy: session.user.id,
    })
    .returning();

  await audit({
    entityType: "ShiftHandover",
    entityId: handover.id,
    action: "create",
    description: `Shift handover counted ${parsed.data.blindCount} vs expected ${expected}`,
    newValues: { expectedCash: expected, difference },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json(
    { ok: true, handover: { ...handover, difference } },
    { status: 201 },
  );
}
