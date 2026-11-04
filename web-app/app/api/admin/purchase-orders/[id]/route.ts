import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  categories,
  poDetails,
  products,
  purchaseOrders,
  supplierPayments,
  suppliers,
} from "@/db/schema";
import { getSession } from "@/lib/auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;

  const [po] = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.name,
      orderDate: purchaseOrders.orderDate,
      expectedDate: purchaseOrders.expectedDate,
      status: purchaseOrders.status,
      approvalStatus: purchaseOrders.approvalStatus,
      paymentStatus: purchaseOrders.paymentStatus,
      totalAmount: purchaseOrders.totalAmount,
      createdBy: purchaseOrders.createdBy,
      createdAt: purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .leftJoin(suppliers, and(eq(purchaseOrders.supplierId, suppliers.id), eq(suppliers.isDeleted, false)))
    .where(
      and(eq(purchaseOrders.id, id), eq(purchaseOrders.branchId, session.user.branchId)),
    )
    .limit(1);

  if (!po) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const details = await db
    .select({
      id: poDetails.id,
      productId: poDetails.productId,
      productName: products.name,
      categoryName: categories.name,
      quantity: poDetails.quantity,
      unitPrice: poDetails.unitPrice,
    })
    .from(poDetails)
    .leftJoin(products, and(eq(poDetails.productId, products.id), eq(products.isDeleted, false)))
    .leftJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.isDeleted, false)))
    .where(eq(poDetails.poId, id));

  const paymentHistory = await db
    .select()
    .from(supplierPayments)
    .where(
      and(
        eq(supplierPayments.poId, id),
        eq(supplierPayments.branchId, session.user.branchId),
      ),
    )
    .orderBy(desc(supplierPayments.paymentDate));

  return NextResponse.json({ ok: true, purchaseOrder: { ...po, details, paymentHistory } });
}
