import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import Decimal from "decimal.js";

import { db } from "@/db";
import { purchaseOrders, supplierPayments, suppliers } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { postJournal } from "@/lib/gl";

const createPaymentSchema = z.object({
  supplierId: z.string().uuid(),
  poId: z.string().uuid().optional(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  paymentDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid date"),
  method: z.enum(["cash", "bank_transfer", "mobile_payment"]),
  reference: z.string().max(100).optional(),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 100));
  const supplierId = url.searchParams.get("supplierId");
  const poId = url.searchParams.get("poId");

  const conditions = [eq(supplierPayments.branchId, session.user.branchId)];
  if (supplierId) conditions.push(eq(supplierPayments.supplierId, supplierId));
  if (poId) conditions.push(eq(supplierPayments.poId, poId));

  const allPayments = await db
    .select({
      id: supplierPayments.id,
      supplierId: supplierPayments.supplierId,
      supplierName: suppliers.name,
      poId: supplierPayments.poId,
      poNumber: purchaseOrders.poNumber,
      amount: supplierPayments.amount,
      paymentDate: supplierPayments.paymentDate,
      method: supplierPayments.method,
      reference: supplierPayments.reference,
      recordedBy: supplierPayments.recordedBy,
      createdAt: supplierPayments.createdAt,
    })
    .from(supplierPayments)
    .leftJoin(suppliers, and(eq(supplierPayments.supplierId, suppliers.id), eq(suppliers.isDeleted, false)))
    .leftJoin(purchaseOrders, eq(supplierPayments.poId, purchaseOrders.id))
    .where(and(...conditions))
    .orderBy(desc(supplierPayments.paymentDate))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, payments: allPayments, page, pageSize });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createPaymentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { supplierId, poId, amount, paymentDate, method, reference } = parsed.data;
  if (new Decimal(amount).lte(0)) {
    return NextResponse.json({ ok: false, error: "AMOUNT_MUST_BE_POSITIVE" }, { status: 400 });
  }

  const [supplier] = await db
    .select({ id: suppliers.id, name: suppliers.name })
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

  let po: { id: string; totalAmount: string } | undefined;
  if (poId) {
    [po] = await db
      .select({ id: purchaseOrders.id, totalAmount: purchaseOrders.totalAmount })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, poId),
          eq(purchaseOrders.branchId, session.user.branchId),
          eq(purchaseOrders.supplierId, supplierId),
        ),
      )
      .limit(1);
    if (!po) {
      return NextResponse.json({ ok: false, error: "PO_NOT_FOUND" }, { status: 404 });
    }
  }

  const result = await db.transaction(async (tx) => {
    const [newPayment] = await tx
      .insert(supplierPayments)
      .values({
        branchId: session.user.branchId,
        supplierId,
        poId: poId ?? null,
        amount,
        paymentDate: new Date(paymentDate),
        method,
        reference: reference ?? null,
        recordedBy: session.user.id,
      })
      .returning();

    let warning: string | null = null;
    if (po) {
      const payments = await tx
        .select({ amount: supplierPayments.amount })
        .from(supplierPayments)
        .where(eq(supplierPayments.poId, po.id));
      const totalPaid = payments.reduce(
        (sum, p) => sum.plus(new Decimal(p.amount)),
        new Decimal(0),
      );
      const total = new Decimal(po.totalAmount);
      // §9: warn on overpayment, do not block — it may be a deliberate advance.
      if (totalPaid.greaterThan(total)) warning = "OVERPAYMENT";
      const newPaymentStatus = totalPaid.greaterThanOrEqualTo(total)
        ? "paid"
        : totalPaid.greaterThan(0)
          ? "partial"
          : "unpaid";
      await tx
        .update(purchaseOrders)
        .set({ paymentStatus: newPaymentStatus })
        .where(eq(purchaseOrders.id, po.id));
    }

    // GL auto-posting: Dr AP / Cr cash (or bank for non-cash methods).
    await postJournal(
      {
        branchId: session.user.branchId,
        entryDate: new Date(paymentDate),
        refType: "supplier_payment",
        refId: newPayment.id,
        memo: `Supplier payment to ${supplier.name}${poId ? ` (PO)` : ""}`,
        lines: [
          { accountCode: "2000", debit: new Decimal(amount).toFixed(2) },
          {
            accountCode: method === "cash" ? "1000" : "1010",
            credit: new Decimal(amount).toFixed(2),
          },
        ],
        createdBy: session.user.id,
      },
      tx,
    );
    return { newPayment, warning };
  });

  await audit({
    entityType: "SupplierPayment",
    entityId: result.newPayment.id,
    action: "create",
    description: `Recorded payment: ${amount} to ${supplier.name}`,
    newValues: result.newPayment,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json(
    { ok: true, payment: result.newPayment, warning: result.warning },
    { status: 201 },
  );
}
