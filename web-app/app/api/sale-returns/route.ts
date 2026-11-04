import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import Decimal from "decimal.js";

import { db } from "@/db";
import {
  items,
  saleDetails,
  saleReturnDetails,
  saleReturns,
  sales,
} from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { buildSaleReturnNumber } from "@/lib/numbers";

const createReturnSchema = z.object({
  saleId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        saleDetailId: z.string().uuid(),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 100));

  const rows = await db
    .select({
      id: saleReturns.id,
      returnNumber: saleReturns.returnNumber,
      saleId: saleReturns.saleId,
      saleNumber: sales.saleNumber,
      status: saleReturns.status,
      refundAmount: saleReturns.refundAmount,
      createdAt: saleReturns.createdAt,
    })
    .from(saleReturns)
    .leftJoin(sales, eq(saleReturns.saleId, sales.id))
    .where(eq(saleReturns.branchId, session.user.branchId))
    .orderBy(desc(saleReturns.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({
    ok: true,
    returns: rows,
    page,
    pageSize,
  });
}

// POST — Sale Return (§6.9, §4 R10): without refund.approve the return is
// created as pending and routed to the Admin approval queue.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createReturnSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { saleId, lines } = parsed.data;

  const [sale] = await db
    .select()
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.branchId, session.user.branchId)))
    .limit(1);
  if (!sale || sale.status !== "completed") {
    return NextResponse.json({ ok: false, error: "SALE_NOT_RETURNABLE" }, { status: 400 });
  }

  const detailIds = lines.map((l) => l.saleDetailId);
  const saleLines = await db
    .select()
    .from(saleDetails)
    .where(and(inArray(saleDetails.id, detailIds), eq(saleDetails.saleId, saleId)));
  if (saleLines.length !== detailIds.length) {
    return NextResponse.json({ ok: false, error: "SALE_LINE_NOT_FOUND" }, { status: 404 });
  }

  // Qty already claimed by prior returns (pending or approved).
  const prior = await db
    .select({ saleDetailId: saleReturnDetails.saleDetailId, quantity: saleReturnDetails.quantity })
    .from(saleReturnDetails)
    .innerJoin(saleReturns, eq(saleReturnDetails.returnId, saleReturns.id))
    .where(eq(saleReturns.saleId, saleId));
  const claimed = new Map<string, number>();
  for (const p of prior) {
    claimed.set(p.saleDetailId, (claimed.get(p.saleDetailId) ?? 0) + p.quantity);
  }

  let refundTotal = new Decimal(0);
  const resolvedLines: Array<{
    saleDetailId: string;
    itemId: string;
    quantity: number;
    refundAmount: string;
  }> = [];
  for (const l of lines) {
    const sl = saleLines.find((x) => x.id === l.saleDetailId)!;
    if (l.quantity > sl.quantity - (claimed.get(l.saleDetailId) ?? 0)) {
      return NextResponse.json(
        { ok: false, error: "RETURN_QTY_EXCEEDS_SOLD", saleDetailId: l.saleDetailId },
        { status: 409 },
      );
    }
    // Pro-rata from the charged line total (net of discounts, §4 R10).
    const refund = new Decimal(sl.lineTotal).times(l.quantity).div(sl.quantity).toDecimalPlaces(2);
    refundTotal = refundTotal.plus(refund);
    resolvedLines.push({
      saleDetailId: sl.id,
      itemId: sl.itemId,
      quantity: l.quantity,
      refundAmount: refund.toFixed(2),
    });
  }

  const approved = await hasPermission(session.user.role, "refund.approve");
  const existingCount = (
    await db.select({ id: saleReturns.id }).from(saleReturns).where(eq(saleReturns.saleId, saleId))
  ).length;

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(saleReturns)
      .values({
        branchId: session.user.branchId,
        returnNumber: buildSaleReturnNumber(sale.saleNumber, existingCount + 1),
        saleId,
        status: approved ? "approved" : "pending",
        refundAmount: refundTotal.toFixed(2),
        createdBy: session.user.id,
        approvedBy: approved ? session.user.id : null,
      })
      .returning();
    await tx.insert(saleReturnDetails).values(
      resolvedLines.map((l) => ({
        returnId: row.id,
        saleDetailId: l.saleDetailId,
        itemId: l.itemId,
        quantity: l.quantity,
        refundAmount: l.refundAmount,
      })),
    );
    if (approved) {
      for (const l of resolvedLines) {
        const [batch] = await tx
          .select({ currentStockQuantity: items.currentStockQuantity })
          .from(items)
          .where(eq(items.id, l.itemId))
          .limit(1);
        await tx
          .update(items)
          .set({ currentStockQuantity: (batch?.currentStockQuantity ?? 0) + l.quantity })
          .where(eq(items.id, l.itemId));
      }
    }
    return row;
  });

  await audit({
    entityType: "SaleReturn",
    entityId: created.id,
    action: "create",
    description: `Created sale return ${created.returnNumber} (${created.status})`,
    newValues: { returnNumber: created.returnNumber, refundAmount: refundTotal.toFixed(2) },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json(
    { ok: true, return: created, queued: !approved },
    { status: 201 },
  );
}
