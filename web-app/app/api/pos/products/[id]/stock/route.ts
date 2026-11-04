import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "@/db";
import { items, products } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

// FEFO batch list: stock > 0 ORDER BY expiry ASC NULLS LAST (§4 R15).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { id: productId } = await params;
  const { page, pageSize } = getPaginationParams(new URL(req.url).searchParams);

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.id, productId),
        eq(products.branchId, session.user.branchId),
        eq(products.isDeleted, false),
      ),
    )
    .limit(1);
  if (!product) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const batches = await db
    .select({
      id: items.id,
      barcode: items.barcode,
      currentStockQuantity: items.currentStockQuantity,
      sellingPrice: items.sellingPrice,
      expiryDate: items.expiryDate,
    })
    .from(items)
    .where(
      and(
        eq(items.productId, productId),
        eq(items.branchId, session.user.branchId),
        gt(items.currentStockQuantity, 0),
      ),
    )
    .orderBy(sql`${items.expiryDate} ASC NULLS LAST`);

  const result = paginateArray(batches, page, pageSize);
  return NextResponse.json({ ok: true, batches: result.items, ...result.pagination });
}
