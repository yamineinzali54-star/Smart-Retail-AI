import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "@/db";
import { items, products } from "@/db/schema";
import { getSession } from "@/lib/auth";

// GET /api/admin/alerts/low-stock — low-stock products for the current branch.
// Product-level rule (same as lib/alert-scan.ts): SUM stock across batches
// per product, compare the SUM to the product's reorder threshold. A product
// with many small batches but a healthy total is NOT low stock. Session
// roles: admin + inventory. Independent of the AI service so the Ops Alerts
// page always shows stock data even when the AI service is down.

export async function GET() {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const rows = await db
    .select({
      product_id: items.productId,
      product_name: sql<string>`MAX(${products.name})`,
      on_hand: sql<number>`COALESCE(SUM(${items.currentStockQuantity}), 0)`,
      reorder_threshold: sql<number>`COALESCE(MAX(${products.reorderThreshold}), 5)`,
    })
    .from(items)
    .innerJoin(products, and(eq(items.productId, products.id), eq(products.isDeleted, false)))
    .where(
      and(
        eq(items.branchId, session.user.branchId),
        gt(items.currentStockQuantity, 0),
      ),
    )
    .groupBy(items.productId)
    .having(
      sql`COALESCE(SUM(${items.currentStockQuantity}), 0) <= COALESCE(MAX(${products.reorderThreshold}), 5)`,
    )
    .orderBy(sql`COALESCE(SUM(${items.currentStockQuantity}), 0)`)
    .limit(500);

  const lowStock = rows.map((r) => ({
    product_id: r.product_id,
    product_name: r.product_name,
    on_hand: Number(r.on_hand) || 0,
    reorder_threshold: Number(r.reorder_threshold) || 5,
  }));

  return NextResponse.json({
    ok: true,
    count: lowStock.length,
    low_stock: lowStock.slice(0, 200),
    truncated: lowStock.length > 200,
  });
}
