import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gt, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { categories, items, products } from "@/db/schema";
import { getSession } from "@/lib/auth";

// Terminal search (≤20 rows): per-product available stock + starting price,
// branch-scoped (§6.8 step 2, §4 R15).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  const categoryId = params.get("categoryId")?.trim() ?? "";
  if (categoryId && !z.string().uuid().safeParse(categoryId).success) {
    return NextResponse.json({ ok: false, error: "INVALID_CATEGORY_ID" }, { status: 400 });
  }
  if (!q && !categoryId) {
    return NextResponse.json({ ok: true, products: [] });
  }

  const productFilters = [
    eq(products.branchId, session.user.branchId),
    eq(products.isDeleted, false),
  ];
  if (categoryId) productFilters.push(eq(products.categoryId, categoryId));
  if (q) productFilters.push(or(ilike(products.name, `%${q}%`))!);

  const matched = await db
    .select({
      id: products.id,
      name: products.name,
      categoryId: products.categoryId,
      categoryName: categories.name,
      unitId: products.unitId,
    })
    .from(products)
    .leftJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.isDeleted, false)))
    .where(and(...productFilters))
    .orderBy(products.name)
    .limit(categoryId ? 100 : 20);

  // Barcode search across batches.
  const byBarcode =
    matched.length === 0 && q
      ? await db
          .select({ productId: items.productId })
          .from(items)
          .where(
            and(eq(items.branchId, session.user.branchId), eq(items.barcode, q)),
          )
      .limit(5)
      : [];

  const ids = [...new Set([...matched.map((m) => m.id), ...byBarcode.map((b) => b.productId)])].slice(0, 20);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, products: [] });
  }

  const finalProducts =
    matched.length > 0
      ? matched
      : await db
          .select({
            id: products.id,
            name: products.name,
            categoryId: products.categoryId,
            categoryName: categories.name,
            unitId: products.unitId,
          })
          .from(products)
          .leftJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.isDeleted, false)))
      .where(
        and(
          inArray(products.id, ids),
          eq(products.branchId, session.user.branchId),
          eq(products.isDeleted, false),
        ),
      );

  const batches = await db
    .select({
      productId: items.productId,
      currentStockQuantity: items.currentStockQuantity,
      sellingPrice: items.sellingPrice,
    })
    .from(items)
    .where(
      and(
        inArray(items.productId, ids),
        eq(items.branchId, session.user.branchId),
        gt(items.currentStockQuantity, 0),
      ),
    );

  const agg = new Map<string, { stock: number; minPrice: string | null }>();
  for (const b of batches) {
    const a = agg.get(b.productId) ?? { stock: 0, minPrice: null as string | null };
    a.stock += b.currentStockQuantity ?? 0;
    if (a.minPrice === null || Number(b.sellingPrice) < Number(a.minPrice)) {
      a.minPrice = b.sellingPrice;
    }
    agg.set(b.productId, a);
  }

  return NextResponse.json({
    ok: true,
    products: finalProducts.map((p) => ({
      ...p,
      availableStock: agg.get(p.id)?.stock ?? 0,
      startingPrice: agg.get(p.id)?.minPrice ?? null,
    })),
  });
}
