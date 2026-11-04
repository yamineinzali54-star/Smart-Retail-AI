import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import { items, products, saleDetails, sales } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

// Dead stock: items with no sales in the last N days.
// ABC analysis: A (top 70% revenue), B (next 20%), C (bottom 10%).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams;
  const { page, pageSize } = getPaginationParams(q);
  const branchId = q.get("branchId") ?? session.user.branchId;
  const deadDays = Math.max(1, Number(q.get("deadDays")) || 30);

  const cutoff = new Date(Date.now() - deadDays * 86_400_000);

  // Get all active products with their stock
  const stockRows = await db
    .select({
      productId: products.id,
      productName: products.name,
      totalStock: sql<string>`coalesce(sum(${items.currentStockQuantity}), 0)`,
    })
    .from(products)
    .leftJoin(items, eq(products.id, items.productId))
    .where(and(eq(products.branchId, branchId), eq(products.isDeleted, false)))
    .groupBy(products.id, products.name);

  // Get sales in the last N days
  const salesRows = await db
    .select({
      productId: saleDetails.productId,
      unitsSold: sql<string>`coalesce(sum(${saleDetails.quantity}), 0)`,
      revenue: sql<string>`coalesce(sum(${saleDetails.lineTotal}), 0)`,
    })
    .from(saleDetails)
    .innerJoin(sales, eq(saleDetails.saleId, sales.id))
    .where(
      and(
        eq(sales.branchId, branchId),
        eq(sales.status, "completed"),
        gte(sales.saleDate, cutoff),
      ),
    )
    .groupBy(saleDetails.productId);

  const salesByProduct = new Map(salesRows.map((r) => [r.productId, r]));

  // Classify
  const deadStock: Array<{ productId: string; productName: string; totalStock: string }> = [];
  const abcRows: Array<{
    productId: string;
    productName: string;
    totalStock: string;
    unitsSold: string;
    revenue: string;
  }> = [];

  for (const row of stockRows) {
    const s = salesByProduct.get(row.productId);
    const unitsSold = s?.unitsSold ?? "0";
    const revenue = s?.revenue ?? "0";

    if (Number(unitsSold) === 0 && Number(row.totalStock) > 0) {
      deadStock.push({
        productId: row.productId,
        productName: row.productName,
        totalStock: row.totalStock,
      });
    }

    abcRows.push({
      productId: row.productId,
      productName: row.productName,
      totalStock: row.totalStock,
      unitsSold,
      revenue,
    });
  }

  // ABC classification by revenue (Pareto)
  const sorted = [...abcRows].sort(
    (a, b) => Number(b.revenue) - Number(a.revenue),
  );
  const totalRevenue = sorted.reduce(
    (s, r) => s.plus(new Decimal(r.revenue)),
    new Decimal(0),
  );

  let cumulative = new Decimal(0);
  const abc = sorted.map((r) => {
    cumulative = cumulative.plus(new Decimal(r.revenue));
    const pct = totalRevenue.gt(0)
      ? cumulative.div(totalRevenue).times(100).toNumber()
      : 0;
    const classification = pct <= 70 ? "A" : pct <= 90 ? "B" : "C";
    return {
      ...r,
      revenuePct: totalRevenue.gt(0)
        ? new Decimal(r.revenue).div(totalRevenue).times(100).toFixed(1)
        : "0.0",
      cumulativePct: pct.toFixed(1),
      classification,
    };
  });

  const deadStockPage = paginateArray(deadStock, page, pageSize);
  const abcPage = paginateArray(abc, page, pageSize);
  return NextResponse.json({
    ok: true,
    deadStock: deadStockPage.items,
    abc: abcPage.items,
    ...abcPage.pagination,
    summary: {
      deadCount: deadStock.length,
      aCount: abc.filter((r) => r.classification === "A").length,
      bCount: abc.filter((r) => r.classification === "B").length,
      cCount: abc.filter((r) => r.classification === "C").length,
    },
  });
}
