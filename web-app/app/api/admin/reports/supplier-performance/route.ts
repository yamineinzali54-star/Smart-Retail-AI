import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import { grns, purchaseOrders, suppliers } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

const DAY = 86_400_000;

// Supplier Performance: PO fulfillment rate, spend, and average lead time
// (first GRN receivedDate − orderDate). No Supplier_Delivery table exists in
// the schema, so lead time is derived from GRN history.
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
      status: purchaseOrders.status,
      totalAmount: purchaseOrders.totalAmount,
      orderDate: purchaseOrders.orderDate,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.branchId, branchId));

  const poIds = pos.map((p) => p.id);
  const grnRows =
    poIds.length === 0
      ? []
      : await db
          .select({ poId: grns.poId, receivedDate: grns.receivedDate })
          .from(grns)
          .where(and(eq(grns.branchId, branchId)));

  const firstGrnByPo = new Map<string, Date>();
  for (const g of grnRows) {
    if (!g.poId) continue;
    const d = new Date(g.receivedDate);
    const prev = firstGrnByPo.get(g.poId);
    if (!prev || d < prev) firstGrnByPo.set(g.poId, d);
  }

  const agg = new Map<
    string,
    { poCount: number; received: number; open: number; spend: Decimal; leadDays: number[] }
  >();
  for (const po of pos) {
    let a = agg.get(po.supplierId);
    if (!a) {
      a = { poCount: 0, received: 0, open: 0, spend: new Decimal(0), leadDays: [] };
      agg.set(po.supplierId, a);
    }
    a.poCount += 1;
    a.spend = a.spend.plus(new Decimal(po.totalAmount));
    if (po.status === "received") a.received += 1;
    else a.open += 1;
    const first = firstGrnByPo.get(po.id);
    if (first) {
      a.leadDays.push((first.getTime() - new Date(po.orderDate).getTime()) / DAY);
    }
  }

  const supplierRows = await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.branchId, branchId), eq(suppliers.isDeleted, false)));

  const rows = supplierRows.map((s) => {
      const a = agg.get(s.id);
      const avgLead =
        a && a.leadDays.length > 0
          ? a.leadDays.reduce((x, y) => x + y, 0) / a.leadDays.length
          : null;
      return {
        supplierId: s.id,
        supplierName: s.name,
        poCount: a?.poCount ?? 0,
        receivedCount: a?.received ?? 0,
        openCount: a?.open ?? 0,
        fulfillmentRate:
          a && a.poCount > 0 ? Number(((a.received / a.poCount) * 100).toFixed(1)) : null,
        totalSpend: (a?.spend ?? new Decimal(0)).toFixed(2),
        avgLeadDays: avgLead === null ? null : Number(avgLead.toFixed(1)),
      };
    });
  const result = paginateArray(rows, page, pageSize);
  return NextResponse.json({ ok: true, suppliers: result.items, ...result.pagination });
}
