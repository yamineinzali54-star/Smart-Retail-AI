import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  categories,
  items,
  productPriceHistory,
  products,
  purchaseOrders,
  units,
} from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const updateBatchSchema = z.object({
  sellingPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  expiryDate: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "invalid date")
    .nullable()
    .optional(),
  remarks: z.string().max(255).nullable().optional(),
  priceChangeReason: z.string().max(255).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { itemId } = await params;

  const [batch] = await db
    .select({
      id: items.id,
      barcode: items.barcode,
      productId: items.productId,
      productName: products.name,
      categoryName: categories.name,
      unitName: units.name,
      reorderThreshold: products.reorderThreshold,
      receivedQuantity: items.receivedQuantity,
      currentStockQuantity: items.currentStockQuantity,
      purchasePrice: items.purchasePrice,
      sellingPrice: items.sellingPrice,
      expiryDate: items.expiryDate,
      remarks: items.remarks,
      poId: items.poId,
      poNumber: purchaseOrders.poNumber,
      grnId: items.grnId,
    })
    .from(items)
    .innerJoin(products, and(eq(items.productId, products.id), eq(products.isDeleted, false)))
    .leftJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.isDeleted, false)))
    .leftJoin(units, and(eq(products.unitId, units.id), eq(units.isDeleted, false)))
    .leftJoin(purchaseOrders, eq(items.poId, purchaseOrders.id))
    .where(and(eq(items.id, itemId), eq(items.branchId, session.user.branchId)))
    .limit(1);

  if (!batch) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const priceHistory = await db
    .select()
    .from(productPriceHistory)
    .where(eq(productPriceHistory.productId, batch.productId))
    .orderBy(desc(productPriceHistory.changedAt))
    .limit(20);

  return NextResponse.json({ ok: true, item: { ...batch, priceHistory } });
}

// PATCH — edit batch selling price / expiry / remarks. A selling-price change
// writes one Product_Price_History row in the same transaction (§4 R23).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { itemId } = await params;

  const parsed = updateBatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (
    parsed.data.sellingPrice === undefined &&
    parsed.data.expiryDate === undefined &&
    parsed.data.remarks === undefined
  ) {
    return NextResponse.json({ ok: false, error: "NOTHING_TO_UPDATE" }, { status: 400 });
  }

  const [batch] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.branchId, session.user.branchId)))
    .limit(1);
  if (!batch) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const updated = await db.transaction(async (tx) => {
    const patch: Partial<typeof items.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.sellingPrice !== undefined) patch.sellingPrice = parsed.data.sellingPrice;
    if (parsed.data.expiryDate !== undefined) {
      patch.expiryDate = parsed.data.expiryDate ? new Date(parsed.data.expiryDate) : null;
    }
    if (parsed.data.remarks !== undefined) patch.remarks = parsed.data.remarks;
    const [row] = await tx.update(items).set(patch).where(eq(items.id, itemId)).returning();
    if (parsed.data.sellingPrice !== undefined && parsed.data.sellingPrice !== batch.sellingPrice) {
      await tx.insert(productPriceHistory).values({
        productId: batch.productId,
        oldPrice: batch.sellingPrice,
        newPrice: parsed.data.sellingPrice,
        changedBy: session.user.id,
        reason: parsed.data.priceChangeReason ?? null,
      });
    }
    return row;
  });

  await audit({
    entityType: "Product",
    entityId: batch.productId,
    action: "price_change",
    description: `Updated batch ${batch.barcode}`,
    oldValues: {
      sellingPrice: batch.sellingPrice,
      expiryDate: batch.expiryDate,
      remarks: batch.remarks,
    },
    newValues: parsed.data,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, item: updated });
}
