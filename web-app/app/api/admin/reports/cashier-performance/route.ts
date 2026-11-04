import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import { posSessions, saleReturnDetails, saleReturns, sales, users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

// Cashier performance: per-cashier sales, voids, discounts, returns, discrepancies.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams;
  const { page, pageSize } = getPaginationParams(q);
  const branchId = q.get("branchId") ?? session.user.branchId;
  const startDate = q.get("startDate");
  const endDate = q.get("endDate");

  const conditions = [eq(sales.branchId, branchId)];
  if (startDate) conditions.push(gte(sales.saleDate, new Date(startDate)));
  if (endDate) conditions.push(lte(sales.saleDate, new Date(endDate)));

  const rows = await db
    .select({
      cashierId: sales.createdBy,
      cashierName: users.fullName,
      totalSales: sql<string>`coalesce(sum(case when ${sales.status} = 'completed' then ${sales.grandTotal} else 0 end), 0)`,
      saleCount: sql<string>`count(case when ${sales.status} = 'completed' then 1 end)`,
      voidCount: sql<string>`count(case when ${sales.status} = 'voided' then 1 end)`,
      totalDiscount: sql<string>`coalesce(sum(case when ${sales.status} = 'completed' then ${sales.discountAmount} else 0 end), 0)`,
      totalTax: sql<string>`coalesce(sum(case when ${sales.status} = 'completed' then ${sales.tax} else 0 end), 0)`,
    })
    .from(sales)
    .leftJoin(users, eq(sales.createdBy, users.id))
    .where(and(...conditions))
    .groupBy(sales.createdBy, users.fullName);

  // Returns per cashier
  const saleIds = (
    await db.select({ id: sales.id }).from(sales).where(and(...conditions))
  ).map((s) => s.id);

  let returnTotal = new Decimal(0);
  let returnCount = 0;
  if (saleIds.length > 0) {
    const { inArray } = await import("drizzle-orm");
    const returns = await db
      .select({ refundAmount: saleReturnDetails.refundAmount })
      .from(saleReturnDetails)
      .innerJoin(saleReturns, eq(saleReturnDetails.returnId, saleReturns.id))
      .where(and(inArray(saleReturns.saleId, saleIds), eq(saleReturns.status, "approved")));
    returnCount = returns.length;
    returnTotal = returns.reduce((s, r) => s.plus(new Decimal(r.refundAmount)), new Decimal(0));
  }

  // Discrepancies per cashier
  const sessionConditions = [eq(posSessions.branchId, branchId), eq(posSessions.status, "closed")];
  if (startDate) sessionConditions.push(gte(posSessions.startTime, new Date(startDate)));
  if (endDate) sessionConditions.push(lte(posSessions.startTime, new Date(endDate)));

  const discrepancyRows = await db
    .select({
      userId: posSessions.userId,
      totalDiff: sql<string>`coalesce(sum(abs(${posSessions.cashDifference})), 0)`,
      diffCount: sql<string>`count(case when ${posSessions.cashDifference} != 0 then 1 end)`,
    })
    .from(posSessions)
    .where(and(...sessionConditions))
    .groupBy(posSessions.userId);

  const diffByUser = new Map(discrepancyRows.map((r) => [r.userId, r]));

  const performance = rows.map((r) => {
    const diff = diffByUser.get(r.cashierId ?? "");
    return {
      cashierId: r.cashierId ?? "",
      cashierName: r.cashierName ?? "—",
      totalSales: new Decimal(r.totalSales).toFixed(2),
      saleCount: Number(r.saleCount),
      voidCount: Number(r.voidCount),
      totalDiscount: new Decimal(r.totalDiscount).toFixed(2),
      totalTax: new Decimal(r.totalTax).toFixed(2),
      returnCount,
      returnTotal: returnTotal.toFixed(2),
      discrepancyTotal: new Decimal(diff?.totalDiff ?? 0).toFixed(2),
      discrepancyCount: Number(diff?.diffCount ?? 0),
    };
  });

  const result = paginateArray(performance, page, pageSize);
  return NextResponse.json({ ok: true, performance: result.items, ...result.pagination });
}
