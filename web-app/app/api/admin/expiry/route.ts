import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gt, lte } from "drizzle-orm";

import { db } from "@/db";
import { categories, items, products } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

// §6.5 — Expiry Index: batches with expiry <= now+threshold AND stock > 0.
// Returns expired vs expiring_soon buckets with counts (§4 R17).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const searchParams = new URL(req.url).searchParams;
  const { page, pageSize } = getPaginationParams(searchParams);
  const daysThreshold = Math.max(
    1,
    Number(searchParams.get("daysThreshold")) || 30,
  );
  const cutoff = new Date(Date.now() + daysThreshold * 86_400_000);
  const now = new Date();

  const rows = await db
    .select({
      id: items.id,
      barcode: items.barcode,
      productId: items.productId,
      productName: products.name,
      categoryName: categories.name,
      currentStockQuantity: items.currentStockQuantity,
      sellingPrice: items.sellingPrice,
      expiryDate: items.expiryDate,
    })
    .from(items)
    .innerJoin(products, and(eq(items.productId, products.id), eq(products.isDeleted, false)))
    .leftJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.isDeleted, false)))
    .where(
      and(
        eq(items.branchId, session.user.branchId),
        gt(items.currentStockQuantity, 0),
        lte(items.expiryDate, cutoff),
      ),
    )
    .orderBy(items.expiryDate);

  const expired = rows.filter((r) => r.expiryDate && new Date(r.expiryDate) < now);
  const expiringSoon = rows.filter((r) => r.expiryDate && new Date(r.expiryDate) >= now);
  const expiredPage = paginateArray(expired, page, pageSize);
  const expiringSoonPage = paginateArray(expiringSoon, page, pageSize);

  return NextResponse.json({
    ok: true,
    expired: expiredPage.items,
    expiringSoon: expiringSoonPage.items,
    ...expiringSoonPage.pagination,
    counts: { expired: expired.length, expiringSoon: expiringSoon.length },
    daysThreshold,
  });
}
