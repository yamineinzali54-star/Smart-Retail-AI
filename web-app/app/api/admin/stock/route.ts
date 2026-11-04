import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, gt, ilike, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { categories, items, products } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getPaginationMeta } from "@/lib/pagination";

// §6.5 — Stock Index: batch-level rows with product/category joins.
// Filters: search (name/barcode), categoryId, lowStock, expiringSoon(days).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 100));
  const search = url.searchParams.get("search")?.trim();
  const categoryId = url.searchParams.get("categoryId");
  const lowStock = url.searchParams.get("lowStock") === "true";
  const expiringSoonDays = Number(url.searchParams.get("expiringSoonDays") ?? "0") || 0;

  const conditions = [eq(items.branchId, session.user.branchId), eq(products.isDeleted, false)];
  if (search) {
    conditions.push(
      or(ilike(products.name, `%${search}%`), ilike(items.barcode, `%${search}%`))!,
    );
  }
  if (categoryId) conditions.push(eq(products.categoryId, categoryId));
  if (lowStock) {
    conditions.push(lte(items.currentStockQuantity, sql`coalesce(${products.reorderThreshold}, 5)`));
  }
  if (expiringSoonDays > 0) {
    const soonCutoff = new Date(Date.now() + expiringSoonDays * 86_400_000);
    conditions.push(gt(items.currentStockQuantity, 0), lte(items.expiryDate, soonCutoff));
  }

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(items)
    .innerJoin(products, and(eq(items.productId, products.id), eq(products.isDeleted, false)))
    .where(and(...conditions));

  const rows = await db
    .select({
      id: items.id,
      barcode: items.barcode,
      productId: items.productId,
      productName: products.name,
      categoryId: products.categoryId,
      categoryName: categories.name,
      receivedQuantity: items.receivedQuantity,
      currentStockQuantity: items.currentStockQuantity,
      reorderThreshold: products.reorderThreshold,
      purchasePrice: items.purchasePrice,
      sellingPrice: items.sellingPrice,
      expiryDate: items.expiryDate,
      poId: items.poId,
      grnId: items.grnId,
    })
    .from(items)
    .innerJoin(products, and(eq(items.productId, products.id), eq(products.isDeleted, false)))
    .leftJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.isDeleted, false)))
    .where(and(...conditions))
    .orderBy(desc(items.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({
    ok: true,
    stock: rows,
    ...getPaginationMeta(page, pageSize, total),
  });
}
