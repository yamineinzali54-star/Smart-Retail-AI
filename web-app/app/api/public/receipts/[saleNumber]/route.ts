import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { branches, products, saleDetails, sales } from "@/db/schema";

// Public e-receipt (QR scans land here — no session). Minimal fields only:
// no customer data, no PAN, no cash tendered, no internal notes.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ saleNumber: string }> },
) {
  const { saleNumber } = await params;

  const [sale] = await db
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      saleDate: sales.saleDate,
      branchName: branches.name,
      subtotal: sales.subtotal,
      discountAmount: sales.discountAmount,
      tax: sales.tax,
      roundingAdjustment: sales.roundingAdjustment,
      grandTotal: sales.grandTotal,
      paymentMethod: sales.paymentMethod,
      status: sales.status,
    })
    .from(sales)
    .leftJoin(branches, eq(sales.branchId, branches.id))
    .where(eq(sales.saleNumber, saleNumber))
    .limit(1);

  if (!sale || sale.status !== "completed") {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const lines = await db
    .select({
      productName: products.name,
      quantity: saleDetails.quantity,
      unitPrice: saleDetails.unitPrice,
      discount: saleDetails.discount,
      lineTotal: saleDetails.lineTotal,
    })
    .from(saleDetails)
    .leftJoin(products, and(eq(saleDetails.productId, products.id), eq(products.isDeleted, false)))
    .where(eq(saleDetails.saleId, sale.id));

  return NextResponse.json({ ok: true, receipt: { ...sale, lines } });
}
