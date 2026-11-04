import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import { items, saleDetails, saleReturnDetails, saleReturns } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { postJournal } from "@/lib/gl";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  if (!(await hasPermission(session.user.role, "refund.approve"))) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const [ret] = await db
    .select()
    .from(saleReturns)
    .where(and(eq(saleReturns.id, id), eq(saleReturns.branchId, session.user.branchId)))
    .limit(1);
  if (!ret) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  if (ret.status !== "pending") {
    return NextResponse.json({ ok: false, error: "ALREADY_DECIDED" }, { status: 400 });
  }

  const lines = await db
    .select()
    .from(saleReturnDetails)
    .where(eq(saleReturnDetails.returnId, id));

  await db.transaction(async (tx) => {
    for (const line of lines) {
      const [batch] = await tx
        .select({ currentStockQuantity: items.currentStockQuantity })
        .from(items)
        .where(eq(items.id, line.itemId))
        .limit(1);
      await tx
        .update(items)
        .set({ currentStockQuantity: (batch?.currentStockQuantity ?? 0) + line.quantity })
        .where(eq(items.id, line.itemId));
    }

    let refundTax = new Decimal(0);
    for (const line of lines) {
      const [originalLine] = await tx
        .select({ taxRateApplied: saleDetails.taxRateApplied })
        .from(saleDetails)
        .where(eq(saleDetails.id, line.saleDetailId))
        .limit(1);
      const rate = new Decimal(originalLine?.taxRateApplied ?? "0");
      if (rate.gt(0)) {
        refundTax = refundTax.plus(
          new Decimal(line.refundAmount).times(rate).div(rate.plus(100)),
        );
      }
    }

    const refundTaxRounded = refundTax.toDecimalPlaces(2);
    const refundNet = new Decimal(ret.refundAmount).minus(refundTaxRounded);
    await tx
      .update(saleReturns)
      .set({ status: "approved", approvedBy: session.user.id })
      .where(eq(saleReturns.id, id));

    await postJournal(
      {
        branchId: session.user.branchId,
        refType: "sale_return",
        refId: id,
        memo: `Sale return ${ret.returnNumber} approved`,
        lines: [
          { accountCode: "4000", debit: refundNet.toFixed(2) },
          { accountCode: "2100", debit: refundTaxRounded.toFixed(2) },
          { accountCode: "1000", credit: new Decimal(ret.refundAmount).toFixed(2) },
        ],
        createdBy: session.user.id,
      },
      tx,
    );
  });

  await audit({
    entityType: "SaleReturn",
    entityId: id,
    action: "approve",
    description: `Approved sale return ${ret.returnNumber}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, resolution: "cash_refund" });
}
