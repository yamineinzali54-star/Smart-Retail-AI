import "server-only";

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import Decimal from "decimal.js";

import { db } from "@/db";
import {
  branches,
  carts,
  cartItems,
  notifications,
  posSessions,
  saleReturnDetails,
  saleReturns,
  sales,
} from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notifyTelegram } from "@/lib/telegram";

const closeSessionSchema = z.object({
  actualClosingCash: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { id } = await params;

  const parsed = closeSessionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [pos] = await db
    .select()
    .from(posSessions)
    .where(
      and(eq(posSessions.id, id), eq(posSessions.branchId, session.user.branchId)),
    )
    .limit(1);
  if (!pos) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  if (pos.status !== "active") {
    return NextResponse.json({ ok: false, error: "SESSION_NOT_ACTIVE" }, { status: 400 });
  }
  if (session.user.role !== "admin" && pos.userId !== session.user.id) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const cashSales = await db
    .select({ grandTotal: sales.grandTotal })
    .from(sales)
    .where(
      and(
        eq(sales.posSessionId, id),
        eq(sales.status, "completed"),
        eq(sales.paymentMethod, "cash"),
      ),
    );
  const cashTotal = cashSales.reduce(
    (s, x) => s.plus(new Decimal(x.grandTotal)),
    new Decimal(0),
  );

  // Cash refunded back out of the till (approved returns on cash sales).
  const sessionSaleIds = (
    await db.select({ id: sales.id }).from(sales).where(eq(sales.posSessionId, id))
  ).map((s) => s.id);
  let cashRefunds = new Decimal(0);
  if (sessionSaleIds.length > 0) {
    const refunds = await db
      .select({
        refundAmount: saleReturnDetails.refundAmount,
        paymentMethod: sales.paymentMethod,
      })
      .from(saleReturnDetails)
      .innerJoin(saleReturns, eq(saleReturnDetails.returnId, saleReturns.id))
      .innerJoin(sales, eq(saleReturns.saleId, sales.id))
      .where(
        and(
          inArray(saleReturns.saleId, sessionSaleIds),
          eq(saleReturns.status, "approved"),
        ),
      );
    cashRefunds = refunds
      .filter((r) => r.paymentMethod === "cash")
      .reduce((s, r) => s.plus(new Decimal(r.refundAmount)), new Decimal(0));
  }

  const expected = new Decimal(pos.openingCash).plus(cashTotal).minus(cashRefunds);
  const actual = new Decimal(parsed.data.actualClosingCash);
  const difference = actual.minus(expected);

  const [branch] = await db
    .select({
      code: branches.code,
      name: branches.name,
      cashDiscrepancyThreshold: branches.cashDiscrepancyThreshold,
    })
    .from(branches)
    .where(eq(branches.id, session.user.branchId))
    .limit(1);
  const threshold = new Decimal(branch?.cashDiscrepancyThreshold ?? "1000");

  const closed = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(posSessions)
      .set({
        status: "closed",
        endTime: new Date(),
        expectedClosingCash: expected.toFixed(2),
        actualClosingCash: actual.toFixed(2),
        cashDifference: difference.toFixed(2),
      })
      .where(eq(posSessions.id, id))
      .returning();
    const [cart] = await tx
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.posSessionId, id))
      .limit(1);
    if (cart) {
      await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));
      await tx.delete(carts).where(eq(carts.id, cart.id));
    }
    // §4 R20 — alert Admin when the discrepancy exceeds the branch threshold.
    if (difference.abs().greaterThan(threshold)) {
      await tx.insert(notifications).values({
        branchId: session.user.branchId,
        userId: null,
        type: "cash_discrepancy",
        title: "Cash discrepancy over threshold",
        message: `Session ${id} closed with difference ${difference.toFixed(2)} (threshold ${threshold.toFixed(2)}).`,
      });
    }
    return row;
  });

  await audit({
    entityType: "POSSession",
    entityId: id,
    action: "close",
    description: `Closed POS session with difference ${difference.toFixed(2)}`,
    newValues: {
      expectedClosingCash: expected.toFixed(2),
      actualClosingCash: actual.toFixed(2),
      cashDifference: difference.toFixed(2),
    },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  // Fire-and-forget: Telegram must never delay or break the close response.
  if (difference.abs().greaterThan(threshold)) {
    void notifyTelegram("cash_discrepancy", {
      branchCode: branch?.code ?? "—",
      branchName: branch?.name ?? "",
      difference: difference.toFixed(2),
      threshold: threshold.toFixed(2),
      sessionLabel: `closed by ${session.user.userName}`,
    });
  }

  return NextResponse.json({ ok: true, session: closed });
}
