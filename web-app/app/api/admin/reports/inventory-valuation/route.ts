import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "@/db";
import { items, products, categories } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId") ?? session.user.branchId;
  const { page, pageSize } = getPaginationParams(searchParams);

  const conditions = [
    gt(items.currentStockQuantity, 0),
    eq(items.branchId, branchId),
    eq(products.isDeleted, false),
  ];

  const valuation = await db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      totalStock: sql<string>`coalesce(sum(${items.currentStockQuantity}), 0)`,
      costValue: sql<string>`coalesce(sum(${items.currentStockQuantity} * ${items.purchasePrice}), 0)`,
      potentialRevenue: sql<string>`coalesce(sum(${items.currentStockQuantity} * ${items.sellingPrice}), 0)`,
      profit: sql<string>`coalesce(sum(${items.currentStockQuantity} * (${items.sellingPrice} - ${items.purchasePrice})), 0)`,
    })
    .from(items)
    .innerJoin(products, and(eq(items.productId, products.id), eq(products.isDeleted, false)))
    .leftJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.isDeleted, false)))
    .where(and(...conditions))
    .groupBy(categories.id, categories.name);

  const grandTotals = await db
    .select({
      totalStock: sql<string>`coalesce(sum(${items.currentStockQuantity}), 0)`,
      costValue: sql<string>`coalesce(sum(${items.currentStockQuantity} * ${items.purchasePrice}), 0)`,
      potentialRevenue: sql<string>`coalesce(sum(${items.currentStockQuantity} * ${items.sellingPrice}), 0)`,
      profit: sql<string>`coalesce(sum(${items.currentStockQuantity} * (${items.sellingPrice} - ${items.purchasePrice})), 0)`,
    })
    .from(items)
    .innerJoin(products, and(eq(items.productId, products.id), eq(products.isDeleted, false)))
    .where(and(...conditions));

  const result = paginateArray(valuation, page, pageSize);

  return NextResponse.json({
    ok: true,
    valuation: result.items,
    ...result.pagination,
    grandTotals: grandTotals[0] ?? { totalStock: "0", costValue: "0", potentialRevenue: "0", profit: "0" },
  });
}
