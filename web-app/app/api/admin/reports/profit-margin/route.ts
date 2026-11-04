import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { categories, items, products, saleDetails, sales } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getPaginationMeta, getPaginationParams } from "@/lib/pagination";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const { page, pageSize } = getPaginationParams(searchParams);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const branchId = searchParams.get("branchId") ?? session.user.branchId;

  const conditions = [
    eq(sales.status, "completed"),
    eq(sales.branchId, branchId),
  ];
  if (startDate) conditions.push(gte(sales.saleDate, new Date(startDate)));
  if (endDate) conditions.push(lte(sales.saleDate, new Date(endDate)));

  const profit = sql<string>`coalesce(sum(${saleDetails.lineTotal} - (${saleDetails.quantity} * ${items.purchasePrice})), 0)`;

  const margin = await db
    .select({
      productId: products.id,
      productName: products.name,
      categoryName: categories.name,
      unitsSold: sql<string>`coalesce(sum(${saleDetails.quantity}), 0)`,
      revenue: sql<string>`coalesce(sum(${saleDetails.lineTotal}), 0)`,
      cost: sql<string>`coalesce(sum(${saleDetails.quantity} * ${items.purchasePrice}), 0)`,
      profit,
    })
    .from(saleDetails)
    .leftJoin(sales, eq(saleDetails.saleId, sales.id))
    .innerJoin(products, and(eq(saleDetails.productId, products.id), eq(products.isDeleted, false)))
    .leftJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.isDeleted, false)))
    .leftJoin(items, eq(saleDetails.itemId, items.id))
    .where(and(...conditions))
    .groupBy(products.id, products.name, categories.name)
    .orderBy(desc(profit))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ total }] = await db
    .select({ total: sql<number>`count(distinct ${saleDetails.productId})::int` })
    .from(saleDetails)
    .leftJoin(sales, eq(saleDetails.saleId, sales.id))
    .where(and(...conditions));

  return NextResponse.json({ ok: true, margin, ...getPaginationMeta(page, pageSize, total) });
}
