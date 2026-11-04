import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "@/db";
import { categories, items, products } from "@/db/schema";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const result = await db
    .select({
      id: categories.id,
      name: categories.name,
      productCount: sql<number>`count(distinct ${items.productId})::int`,
    })
    .from(categories)
    .leftJoin(
      products,
      and(
        eq(products.categoryId, categories.id),
        eq(products.branchId, session.user.branchId),
        eq(products.isDeleted, false),
      ),
    )
    .leftJoin(
      items,
      and(
        eq(items.productId, products.id),
        eq(items.branchId, session.user.branchId),
        gt(items.currentStockQuantity, 0),
      ),
    )
    .where(and(eq(categories.branchId, session.user.branchId), eq(categories.isDeleted, false)))
    .groupBy(categories.id, categories.name)
    .orderBy(categories.name);

  return NextResponse.json({ ok: true, categories: result });
}
