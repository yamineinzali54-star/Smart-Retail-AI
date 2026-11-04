import "server-only";

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { categories, products, supplierProducts, suppliers, units } from "@/db/schema";
import { getSession } from "@/lib/auth";

// Supplier → Category → Product cascade for the PO create form (§6.3).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const supplierId = new URL(req.url).searchParams.get("supplierId");
  if (!supplierId) {
    return NextResponse.json({ ok: false, error: "SUPPLIER_ID_REQUIRED" }, { status: 400 });
  }

  const [supplier] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, supplierId),
        eq(suppliers.branchId, session.user.branchId),
        eq(suppliers.isDeleted, false),
      ),
    )
    .limit(1);
  if (!supplier) {
    return NextResponse.json({ ok: false, error: "SUPPLIER_NOT_FOUND" }, { status: 404 });
  }

  const links = await db
    .select({ productId: supplierProducts.productId })
    .from(supplierProducts)
    .where(eq(supplierProducts.supplierId, supplierId));
  const ids = [...new Set(links.map((l) => l.productId))];
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, products: [], categories: [] });
  }

  const linkedProducts = await db
    .select({
      id: products.id,
      name: products.name,
      categoryId: products.categoryId,
      unitId: products.unitId,
      unitName: units.name,
    })
    .from(products)
    .leftJoin(units, and(eq(products.unitId, units.id), eq(units.isDeleted, false)))
    .where(
      and(
        inArray(products.id, ids),
        eq(products.branchId, session.user.branchId),
        eq(products.isDeleted, false),
      ),
    );

  const categoryIds = [...new Set(linkedProducts.map((p) => p.categoryId))];
  const linkedCategories =
    categoryIds.length === 0
      ? []
      : await db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(
            and(
              inArray(categories.id, categoryIds),
              eq(categories.branchId, session.user.branchId),
              eq(categories.isDeleted, false),
            ),
          );

  return NextResponse.json({
    ok: true,
    products: linkedProducts,
    categories: linkedCategories,
  });
}
