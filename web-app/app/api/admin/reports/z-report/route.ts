import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import {
  posSessions,
  saleReturnDetails,
  saleReturns,
  sales,
  shiftHandovers,
  users,
} from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

// End-of-day Z-report: one day's sales by method, voids, approved refunds,
// and every closed session's till reconciliation. Computed on demand.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams;
  const { page, pageSize } = getPaginationParams(q);
  const branchId = q.get("branchId") ?? session.user.branchId;
  const day = q.get("date") ?? new Date().toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00`);
  const next = new Date(start.getTime() + 86_400_000);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ ok: false, error: "INVALID_DATE" }, { status: 400 });
  }

  const daySales = await db
    .select({
      id: sales.id,
      paymentMethod: sales.paymentMethod,
      status: sales.status,
      grandTotal: sales.grandTotal,
      discountAmount: sales.discountAmount,
      tax: sales.tax,
    })
    .from(sales)
    .where(
      and(
        eq(sales.branchId, branchId),
        gte(sales.saleDate, start),
        lt(sales.saleDate, next),
      ),
    );

  const completed = daySales.filter((s) => s.status === "completed");
  const voided = daySales.filter((s) => s.status === "voided");
  const byMethod: Record<string, { count: number; total: string }> = {};
  let dayTotal = new Decimal(0);
  for (const s of completed) {
    const m = byMethod[s.paymentMethod] ?? { count: 0, total: "0" };
    m.count += 1;
    m.total = new Decimal(m.total).plus(new Decimal(s.grandTotal)).toFixed(2);
    byMethod[s.paymentMethod] = m;
    dayTotal = dayTotal.plus(new Decimal(s.grandTotal));
  }

  const saleIds = daySales.map((s) => s.id);
  let refundTotal = new Decimal(0);
  let refundCount = 0;
  if (saleIds.length > 0) {
    const refunds = await db
      .select({ refundAmount: saleReturnDetails.refundAmount })
      .from(saleReturnDetails)
      .innerJoin(saleReturns, eq(saleReturnDetails.returnId, saleReturns.id))
      .where(and(inArray(saleReturns.saleId, saleIds), eq(saleReturns.status, "approved")));
    refundCount = refunds.length;
    refundTotal = refunds.reduce((s, r) => s.plus(new Decimal(r.refundAmount)), new Decimal(0));
  }

  const sessions = await db
    .select({
      id: posSessions.id,
      cashierName: users.fullName,
      openingCash: posSessions.openingCash,
      expectedClosingCash: posSessions.expectedClosingCash,
      actualClosingCash: posSessions.actualClosingCash,
      cashDifference: posSessions.cashDifference,
      status: posSessions.status,
      endTime: posSessions.endTime,
    })
    .from(posSessions)
    .leftJoin(users, eq(posSessions.userId, users.id))
    .where(
      and(
        eq(posSessions.branchId, branchId),
        gte(posSessions.startTime, start),
        lt(posSessions.startTime, next),
      ),
    );

  const handovers = await db
    .select({
      id: shiftHandovers.id,
      cashierName: users.fullName,
      expectedCash: shiftHandovers.expectedCash,
      blindCount: shiftHandovers.blindCount,
      difference: shiftHandovers.difference,
      handedAt: shiftHandovers.handedAt,
    })
    .from(shiftHandovers)
    .leftJoin(users, eq(shiftHandovers.outgoingUserId, users.id))
    .where(
      and(
        eq(shiftHandovers.branchId, branchId),
        gte(shiftHandovers.handedAt, start),
        lt(shiftHandovers.handedAt, next),
      ),
    );

  const sessionsPage = paginateArray(sessions, page, pageSize);
  const handoversPage = paginateArray(handovers, page, pageSize);

  return NextResponse.json({
    ok: true,
    zReport: {
      date: day,
      saleCount: completed.length,
      voidCount: voided.length,
      dayTotal: dayTotal.toFixed(2),
      byMethod,
      refunds: { count: refundCount, total: refundTotal.toFixed(2) },
      sessions: sessionsPage.items,
      sessionsPagination: sessionsPage.pagination,
      handovers: handoversPage.items,
      handoversPagination: handoversPage.pagination,
    },
  });
}
