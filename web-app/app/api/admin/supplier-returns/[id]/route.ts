import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import {
  grns,
  items,
  products,
  purchaseOrders,
  supplierPayments,
  supplierReturnDetails,
  supplierReturns,
  suppliers,
} from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;

  const [returnData] = await db
    .select({
      id: supplierReturns.id,
      debitNoteNumber: supplierReturns.debitNoteNumber,
      supplierId: supplierReturns.supplierId,
      supplierName: suppliers.name,
      grnId: supplierReturns.grnId,
      returnDate: supplierReturns.returnDate,
      reason: supplierReturns.reason,
      status: supplierReturns.status,
      createdBy: supplierReturns.createdBy,
      createdAt: supplierReturns.createdAt,
    })
    .from(supplierReturns)
    .leftJoin(suppliers, and(eq(supplierReturns.supplierId, suppliers.id), eq(suppliers.isDeleted, false)))
    .where(
      and(
        eq(supplierReturns.id, id),
        eq(supplierReturns.branchId, session.user.branchId),
      ),
    )
    .limit(1);

  if (!returnData) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const details = await db
    .select({
      id: supplierReturnDetails.id,
      itemId: supplierReturnDetails.itemId,
      productName: products.name,
      barcode: items.barcode,
      quantity: supplierReturnDetails.quantity,
      unitCost: supplierReturnDetails.unitCost,
      totalValue: supplierReturnDetails.totalValue,
    })
    .from(supplierReturnDetails)
    .leftJoin(items, eq(supplierReturnDetails.itemId, items.id))
    .leftJoin(products, and(eq(items.productId, products.id), eq(products.isDeleted, false)))
    .where(eq(supplierReturnDetails.returnId, id));

  return NextResponse.json({ ok: true, return: { ...returnData, details } });
}

// §6.7 / §4 R14 — confirm decrements stock; when the linked PO is still
// unpaid/partial, the PO total is reduced by the return value and its
// payment_status recomputed. Requires supplier_return.confirm (admin always).
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  if (!(await hasPermission(session.user.role, "supplier_return.confirm"))) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;

  const [returnData] = await db
    .select()
    .from(supplierReturns)
    .where(
      and(
        eq(supplierReturns.id, id),
        eq(supplierReturns.branchId, session.user.branchId),
      ),
    )
    .limit(1);
  if (!returnData) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  if (returnData.status !== "draft") {
    return NextResponse.json({ ok: false, error: "ALREADY_CONFIRMED" }, { status: 400 });
  }

  const details = await db
    .select()
    .from(supplierReturnDetails)
    .where(eq(supplierReturnDetails.returnId, id));

  const confirmed = await db
    .transaction(async (tx) => {
      let returnTotal = new Decimal(0);
      for (const line of details) {
        const [item] = await tx
          .select({ currentStockQuantity: items.currentStockQuantity })
          .from(items)
          .where(and(eq(items.id, line.itemId), eq(items.branchId, session.user.branchId)))
          .limit(1);
        if (!item) throw new Error("ITEM_NOT_FOUND");
        if ((item.currentStockQuantity ?? 0) < line.quantity) {
          throw new Error("INSUFFICIENT_STOCK");
        }
        await tx
          .update(items)
          .set({ currentStockQuantity: (item.currentStockQuantity ?? 0) - line.quantity })
          .where(eq(items.id, line.itemId));
        returnTotal = returnTotal.plus(new Decimal(line.totalValue));
      }

      // §4 R14 — reduce the outstanding payable via the linked GRN's PO.
      if (returnData.grnId) {
        const [grn] = await tx
          .select({ poId: grns.poId })
          .from(grns)
          .where(eq(grns.id, returnData.grnId))
          .limit(1);
        if (grn) {
          const [po] = await tx
            .select({
              totalAmount: purchaseOrders.totalAmount,
              paymentStatus: purchaseOrders.paymentStatus,
            })
            .from(purchaseOrders)
            .where(eq(purchaseOrders.id, grn.poId))
            .limit(1);
          if (po && (po.paymentStatus === "unpaid" || po.paymentStatus === "partial")) {
            const newTotal = Decimal.max(
              0,
              new Decimal(po.totalAmount).minus(returnTotal),
            ).toFixed(2);
            await tx
              .update(purchaseOrders)
              .set({ totalAmount: newTotal })
              .where(eq(purchaseOrders.id, grn.poId));
            // Recompute payment_status against recorded payments.
            const payments = await tx
              .select({ amount: supplierPayments.amount })
              .from(supplierPayments)
              .where(eq(supplierPayments.poId, grn.poId));
            const totalPaid = payments.reduce(
              (sum, p) => sum.plus(new Decimal(p.amount)),
              new Decimal(0),
            );
            const total = new Decimal(newTotal);
            await tx
              .update(purchaseOrders)
              .set({
                paymentStatus: totalPaid.greaterThanOrEqualTo(total)
                  ? "paid"
                  : totalPaid.greaterThan(0)
                    ? "partial"
                    : "unpaid",
              })
              .where(eq(purchaseOrders.id, grn.poId));
          }
        }
      }

      const [updated] = await tx
        .update(supplierReturns)
        .set({ status: "confirmed", confirmedBy: session.user.id })
        .where(eq(supplierReturns.id, id))
        .returning();
      return updated;
    })
    .catch((err: unknown) => {
      if (err instanceof Error && (err.message === "ITEM_NOT_FOUND" || err.message === "INSUFFICIENT_STOCK")) {
        return err.message;
      }
      throw err;
    });

  if (confirmed === "ITEM_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: "ITEM_NOT_FOUND" }, { status: 404 });
  }
  if (confirmed === "INSUFFICIENT_STOCK") {
    return NextResponse.json({ ok: false, error: "INSUFFICIENT_STOCK" }, { status: 409 });
  }

  await audit({
    entityType: "SupplierReturn",
    entityId: id,
    action: "confirm",
    description: `Confirmed supplier return: ${returnData.debitNoteNumber}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, return: confirmed });
}
