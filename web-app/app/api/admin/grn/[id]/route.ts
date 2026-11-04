import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { categories, grns, items, products, purchaseOrders, suppliers } from "@/db/schema";
import { getSession } from "@/lib/auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;

  const [grn] = await db
    .select({
      id: grns.id,
      grnNumber: grns.grnNumber,
      poId: grns.poId,
      poNumber: purchaseOrders.poNumber,
      supplierName: suppliers.name,
      receivedDate: grns.receivedDate,
      createdBy: grns.createdBy,
      createdAt: grns.createdAt,
    })
    .from(grns)
    .leftJoin(purchaseOrders, eq(grns.poId, purchaseOrders.id))
    .leftJoin(suppliers, and(eq(purchaseOrders.supplierId, suppliers.id), eq(suppliers.isDeleted, false)))
    .where(and(eq(grns.id, id), eq(grns.branchId, session.user.branchId)))
    .limit(1);

  if (!grn) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const batchItems = await db
    .select({
      id: items.id,
      barcode: items.barcode,
      productName: products.name,
      categoryName: categories.name,
      receivedQuantity: items.receivedQuantity,
      currentStockQuantity: items.currentStockQuantity,
      purchasePrice: items.purchasePrice,
      sellingPrice: items.sellingPrice,
      expiryDate: items.expiryDate,
    })
    .from(items)
    .leftJoin(products, and(eq(items.productId, products.id), eq(products.isDeleted, false)))
    .leftJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.isDeleted, false)))
    .where(eq(items.grnId, id));

  return NextResponse.json({ ok: true, grn: { ...grn, items: batchItems } });
}
