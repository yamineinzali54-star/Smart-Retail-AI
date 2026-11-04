import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { counters, posSessions, saleDetails, sales, users } from "@/db/schema";
import { getSession } from "@/lib/auth";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const branchId = searchParams.get("branchId") ?? session.user.branchId;
  const cashierId = searchParams.get("cashierId");
  const counterId = searchParams.get("counterId");
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 100));

  const conditions = [
    eq(sales.status, "completed"),
    eq(sales.branchId, branchId),
  ];
  if (startDate) conditions.push(gte(sales.saleDate, new Date(startDate)));
  if (endDate) conditions.push(lte(sales.saleDate, new Date(endDate)));
  if (cashierId) conditions.push(eq(sales.createdBy, cashierId));
  if (counterId) conditions.push(eq(posSessions.counterId, counterId));

  const salesData = await db
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      saleDate: sales.saleDate,
      grandTotal: sales.grandTotal,
      paymentMethod: sales.paymentMethod,
      cashierName: users.fullName,
      counterName: counters.name,
    })
    .from(sales)
    .leftJoin(posSessions, eq(sales.posSessionId, posSessions.id))
    .leftJoin(users, eq(sales.createdBy, users.id))
    .leftJoin(counters, and(eq(posSessions.counterId, counters.id), eq(counters.isDeleted, false)))
    .where(and(...conditions))
    .orderBy(desc(sales.saleDate))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Sale-level aggregates (no details join — avoids fan-out), plus a
  // separate item count from the details join.
  const saleTotals = await db
    .select({
      totalSales: sql<string>`count(*)`,
      totalAmount: sql<string>`coalesce(sum(${sales.grandTotal}), 0)`,
    })
    .from(sales)
    .leftJoin(posSessions, eq(sales.posSessionId, posSessions.id))
    .where(and(...conditions));
  const itemTotals = await db
    .select({
      totalItems: sql<string>`coalesce(sum(${saleDetails.quantity}), 0)`,
    })
    .from(sales)
    .leftJoin(saleDetails, eq(sales.id, saleDetails.saleId))
    .leftJoin(posSessions, eq(sales.posSessionId, posSessions.id))
    .where(and(...conditions));

  return NextResponse.json({
    ok: true,
    sales: salesData,
    page,
    pageSize,
    totals: {
      totalSales: saleTotals[0]?.totalSales ?? "0",
      totalAmount: saleTotals[0]?.totalAmount ?? "0",
      totalItems: itemTotals[0]?.totalItems ?? "0",
    },
  });
}
