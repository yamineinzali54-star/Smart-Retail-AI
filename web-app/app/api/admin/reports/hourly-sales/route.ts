import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import { sales } from "@/db/schema";
import { getSession } from "@/lib/auth";

// Hourly sales distribution for shift planning.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams;
  const branchId = q.get("branchId") ?? session.user.branchId;
  const startDate = q.get("startDate");
  const endDate = q.get("endDate");

  const conditions = [eq(sales.status, "completed"), eq(sales.branchId, branchId)];
  if (startDate) conditions.push(gte(sales.saleDate, new Date(startDate)));
  if (endDate) conditions.push(lte(sales.saleDate, new Date(endDate)));

  const rows = await db
    .select({
      hour: sql<string>`extract(hour from ${sales.saleDate})`,
      saleCount: sql<string>`count(*)`,
      totalAmount: sql<string>`coalesce(sum(${sales.grandTotal}), 0)`,
      avgAmount: sql<string>`coalesce(avg(${sales.grandTotal}), 0)`,
    })
    .from(sales)
    .where(and(...conditions))
    .groupBy(sql`extract(hour from ${sales.saleDate})`)
    .orderBy(sql`extract(hour from ${sales.saleDate})`);

  const hourly = rows.map((r) => ({
    hour: Number(r.hour),
    hourLabel: `${String(Number(r.hour)).padStart(2, "0")}:00`,
    saleCount: Number(r.saleCount),
    totalAmount: new Decimal(r.totalAmount).toFixed(2),
    avgAmount: new Decimal(r.avgAmount).toFixed(2),
  }));

  const peak = hourly.reduce(
    (best, h) => (h.saleCount > (best?.saleCount ?? 0) ? h : best),
    hourly[0] ?? null,
  );

  return NextResponse.json({ ok: true, hourly, peak });
}
