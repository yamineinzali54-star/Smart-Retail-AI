import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import { purchaseOrders, supplierPayments, suppliers } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

const DAY = 86_400_000;

// Accounts Payable: outstanding per supplier with aging buckets computed from
// each UNPAID PART's order date (0–30 / 31–60 / 60+ days). Aggregated in JS to
// avoid the PO × payments join fan-out that corrupts SQL SUMs.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const searchParams = new URL(req.url).searchParams;
  const branchId = searchParams.get("branchId") ?? session.user.branchId;
  const { page, pageSize } = getPaginationParams(searchParams);

  const pos = await db
    .select({
      id: purchaseOrders.id,
      supplierId: purchaseOrders.supplierId,
      totalAmount: purchaseOrders.totalAmount,
      orderDate: purchaseOrders.orderDate,
    })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.branchId, branchId)));

  const payments = await db
    .select({ poId: supplierPayments.poId, amount: supplierPayments.amount })
    .from(supplierPayments)
    .where(eq(supplierPayments.branchId, branchId));

  const paidByPo = new Map<string, Decimal>();
  for (const p of payments) {
    if (!p.poId) continue;
    paidByPo.set(p.poId, (paidByPo.get(p.poId) ?? new Decimal(0)).plus(new Decimal(p.amount)));
  }

  const bySupplier = new Map<
    string,
    { total: Decimal; paid: Decimal; aging: { d0_30: Decimal; d31_60: Decimal; d60plus: Decimal } }
  >();
  const now = Date.now();
  for (const po of pos) {
    const total = new Decimal(po.totalAmount);
    const paid = paidByPo.get(po.id) ?? new Decimal(0);
    const outstanding = total.minus(paid);
    let agg = bySupplier.get(po.supplierId);
    if (!agg) {
      agg = {
        total: new Decimal(0),
        paid: new Decimal(0),
        aging: { d0_30: new Decimal(0), d31_60: new Decimal(0), d60plus: new Decimal(0) },
      };
      bySupplier.set(po.supplierId, agg);
    }
    agg.total = agg.total.plus(total);
    agg.paid = agg.paid.plus(Decimal.min(paid, total));
    if (outstanding.greaterThan(0)) {
      const ageDays = (now - new Date(po.orderDate).getTime()) / DAY;
      if (ageDays <= 30) agg.aging.d0_30 = agg.aging.d0_30.plus(outstanding);
      else if (ageDays <= 60) agg.aging.d31_60 = agg.aging.d31_60.plus(outstanding);
      else agg.aging.d60plus = agg.aging.d60plus.plus(outstanding);
    }
  }

  const supplierRows = await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.branchId, branchId), eq(suppliers.isDeleted, false)));

  const payables = supplierRows.map((s) => {
    const agg = bySupplier.get(s.id);
    const balance = (agg?.total ?? new Decimal(0)).minus(agg?.paid ?? new Decimal(0));
    return {
      supplierId: s.id,
      supplierName: s.name,
      totalAmount: (agg?.total ?? new Decimal(0)).toFixed(2),
      paidAmount: (agg?.paid ?? new Decimal(0)).toFixed(2),
      balance: balance.toFixed(2),
      aging: {
        d0_30: (agg?.aging.d0_30 ?? new Decimal(0)).toFixed(2),
        d31_60: (agg?.aging.d31_60 ?? new Decimal(0)).toFixed(2),
        d60plus: (agg?.aging.d60plus ?? new Decimal(0)).toFixed(2),
      },
    };
  });

  const result = paginateArray(payables, page, pageSize);
  return NextResponse.json({ ok: true, payables: result.items, ...result.pagination });
}
