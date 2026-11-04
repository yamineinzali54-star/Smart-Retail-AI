import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import { counters, posSessions, sales, users } from "@/db/schema";
import { getSession } from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { id } = await params;

  const [pos] = await db
    .select({
      id: posSessions.id,
      userId: posSessions.userId,
      cashierName: users.fullName,
      counterId: posSessions.counterId,
      counterName: counters.name,
      branchId: posSessions.branchId,
      startTime: posSessions.startTime,
      endTime: posSessions.endTime,
      status: posSessions.status,
      openingCash: posSessions.openingCash,
      expectedClosingCash: posSessions.expectedClosingCash,
      actualClosingCash: posSessions.actualClosingCash,
      cashDifference: posSessions.cashDifference,
    })
    .from(posSessions)
    .leftJoin(users, eq(posSessions.userId, users.id))
    .leftJoin(counters, and(eq(posSessions.counterId, counters.id), eq(counters.isDeleted, false)))
    .where(
      and(eq(posSessions.id, id), eq(posSessions.branchId, session.user.branchId)),
    )
    .limit(1);
  if (!pos) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  if (session.user.role !== "admin" && pos.userId !== session.user.id) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const sessionSales = await db
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      grandTotal: sales.grandTotal,
      paymentMethod: sales.paymentMethod,
      status: sales.status,
      saleDate: sales.saleDate,
    })
    .from(sales)
    .where(eq(sales.posSessionId, id))
    .orderBy(desc(sales.saleDate));

  const completed = sessionSales.filter((s) => s.status === "completed");
  const totals = completed.reduce(
    (s, x) => s.plus(new Decimal(x.grandTotal)),
    new Decimal(0),
  );

  return NextResponse.json({
    ok: true,
    report: {
      session: pos,
      sales: sessionSales,
      saleCount: completed.length,
      voidCount: sessionSales.filter((s) => s.status === "voided").length,
      totalSales: totals.toFixed(2),
    },
  });
}
