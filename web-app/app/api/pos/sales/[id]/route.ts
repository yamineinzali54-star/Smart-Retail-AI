import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getTableColumns } from "drizzle-orm";

import { db } from "@/db";
import {
  branches,
  products,
  saleDetails,
  sales,
} from "@/db/schema";
import { getSession } from "@/lib/auth";

// Sale detail with lines — powers the sale-return lookup (same branch;
// cashers see their own sales, admins see all).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { id } = await params;

  const [row] = await db
    .select({
      ...getTableColumns(sales),
      branchCode: branches.code,
      branchName: branches.name,
      registrationNo: branches.registrationNo,
      taxInvoicePrefix: branches.taxInvoicePrefix,
    })
    .from(sales)
    .leftJoin(branches, eq(sales.branchId, branches.id))
    .where(and(eq(sales.id, id), eq(sales.branchId, session.user.branchId)))
    .limit(1);
  if (!row) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  const {
    branchCode,
    branchName,
    registrationNo,
    taxInvoicePrefix,
    ...sale
  } = row;
  if (session.user.role !== "admin" && sale.createdBy !== session.user.id) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const lines = await db
    .select({
      id: saleDetails.id,
      productName: products.name,
      quantity: saleDetails.quantity,
      unitPrice: saleDetails.unitPrice,
      discount: saleDetails.discount,
      lineTotal: saleDetails.lineTotal,
    })
    .from(saleDetails)
    .leftJoin(products, and(eq(saleDetails.productId, products.id), eq(products.isDeleted, false)))
    .where(eq(saleDetails.saleId, id));

  return NextResponse.json({
    ok: true,
    sale: {
      ...sale,
      branchCode,
      branchName,
      registrationNo,
      taxInvoicePrefix,
      lines,
    },
  });
}
