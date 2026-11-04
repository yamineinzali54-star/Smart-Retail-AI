import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import Decimal from "decimal.js";

import { db } from "@/db";
import {
  branches,
  cartItems,
  carts,
  categories,
  items,
  products,
  saleDetails,
  sales,
} from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { buildSaleNumber } from "@/lib/numbers";
import { postJournal } from "@/lib/gl";
import { computeCartTotals, getActivePromos, getActiveSession, type PosCartLine } from "@/lib/pos";

const checkoutSchema = z.object({
  paymentMethod: z.literal("cash"),
  cashReceived: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  lineDiscounts: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        discount: z.string().regex(/^\d+(\.\d{1,2})?$/),
      }),
    )
    .optional(),
});

// POST — CompleteSale (§6.8 step 3, §4 R6–R9): re-validate, price, pay,
// insert, decrement, ledger, clear cart — all in one transaction.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = checkoutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const active = await getActiveSession(session.user.id);
  if (!active || active.branchId !== session.user.branchId) {
    return NextResponse.json({ ok: false, error: "NO_ACTIVE_SESSION" }, { status: 409 });
  }

  const [cart] = await db
    .select()
    .from(carts)
    .where(and(eq(carts.posSessionId, active.id), eq(carts.status, "active")))
    .limit(1);
  const cartLines = cart
    ? await db.select().from(cartItems).where(eq(cartItems.cartId, cart.id))
    : [];
  if (cartLines.length === 0) {
    return NextResponse.json({ ok: false, error: "CART_EMPTY" }, { status: 400 });
  }

  // Manual line discounts require discount.approve (§2).
  const discountByItem = new Map((body.lineDiscounts ?? []).map((d) => [d.itemId, d.discount]));
  if (discountByItem.size > 0 && !(await hasPermission(session.user.role, "discount.approve"))) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const [branch] = await db
    .select({
      code: branches.code,
      roundingUnit: branches.roundingUnit,
    })
    .from(branches)
    .where(eq(branches.id, session.user.branchId))
    .limit(1);

  // Live batch + category data (never trust client stock/price).
  const pricedLines: PosCartLine[] = [];
  for (const cl of cartLines) {
    const [batch] = await db
      .select()
      .from(items)
      .where(
        and(eq(items.id, cl.itemId), eq(items.branchId, session.user.branchId)),
      )
      .limit(1);
    if (!batch || (batch.currentStockQuantity ?? 0) < cl.quantity) {
      return NextResponse.json(
        { ok: false, error: "INSUFFICIENT_STOCK", itemId: cl.itemId },
        { status: 409 },
      );
    }
    const [prod] = await db
      .select({ categoryId: products.categoryId })
      .from(products)
      .where(and(eq(products.id, cl.productId), eq(products.isDeleted, false)))
      .limit(1);
    if (!prod) {
      return NextResponse.json({ ok: false, error: "PRODUCT_NOT_FOUND", productId: cl.productId }, { status: 404 });
    }
    const [cat] = prod
      ? await db
          .select({ taxRate: categories.taxRate, isTaxExempt: categories.isTaxExempt })
          .from(categories)
          .where(and(eq(categories.id, prod.categoryId), eq(categories.isDeleted, false)))
          .limit(1)
      : [];
    const manual = discountByItem.get(cl.itemId) ?? "0";
    const lineSubtotal = new Decimal(batch.sellingPrice).times(cl.quantity);
    if (new Decimal(manual).greaterThan(lineSubtotal)) {
      return NextResponse.json(
        { ok: false, error: "DISCOUNT_EXCEEDS_LINE", itemId: cl.itemId },
        { status: 400 },
      );
    }
    pricedLines.push({
      productId: cl.productId,
      itemId: cl.itemId,
      quantity: cl.quantity,
      unitPrice: batch.sellingPrice,
      categoryId: prod?.categoryId ?? "",
      taxRate: cat?.taxRate ?? "0",
      isTaxExempt: cat?.isTaxExempt ?? false,
      manualDiscount: manual,
    });
  }

  const promos = await getActivePromos(session.user.branchId);
  const totals = computeCartTotals(pricedLines, promos, branch?.roundingUnit ?? 50);

  const remainder = new Decimal(totals.grandTotal);

  // Payment validation (§4 R7–R8) — against the remainder after tenders.
  let cashReceived: string | null = null;
  let notes: string | null = null;

  if (remainder.gt(0)) {
    if (!body.cashReceived || new Decimal(body.cashReceived).lt(remainder)) {
      return NextResponse.json(
        { ok: false, error: "CASH_INSUFFICIENT", amountDue: remainder.toFixed(2) },
        { status: 400 },
      );
    }
    cashReceived = new Decimal(body.cashReceived).toFixed(2);
    const change = new Decimal(body.cashReceived).minus(remainder).toFixed(2);
    notes = `Cash received ${cashReceived}, change ${change}`;
  } else {
    notes = null;
  }

  try {
    const receipt = await db.transaction(async (tx) => {
      // Re-check stock inside the transaction, then decrement.
      for (const l of totals.lines) {
        const [batch] = await tx
          .select({ currentStockQuantity: items.currentStockQuantity })
          .from(items)
          .where(eq(items.id, l.itemId))
          .limit(1);
        if (!batch || (batch.currentStockQuantity ?? 0) < l.quantity) {
          throw new Error("INSUFFICIENT_STOCK");
        }
      }

      let saleNumber = "";
      let saleId = "";
      for (let attempt = 0; attempt < 5 && !saleId; attempt++) {
        try {
          const dayCount = (
            await tx
              .select({ id: sales.id })
              .from(sales)
              .where(eq(sales.branchId, session.user.branchId))
          ).length;
          const candidate = buildSaleNumber(branch?.code ?? "BR", new Date(), dayCount + 1 + attempt);
          const [sale] = await tx
            .insert(sales)
            .values({
              branchId: session.user.branchId,
              saleNumber: candidate,
              posSessionId: active.id,
              subtotal: totals.subtotal,
              discountAmount: totals.discountAmount,
              tax: totals.tax,
              totalAmount: totals.totalAmount,
              roundingAdjustment: totals.roundingAdjustment,
              grandTotal: totals.grandTotal,
              paymentMethod: body.paymentMethod,
              cashReceived,
              status: "completed",
              notes,
              createdBy: session.user.id,
            })
            .returning({ id: sales.id, saleNumber: sales.saleNumber });
          saleId = sale.id;
          saleNumber = sale.saleNumber;
        } catch (err) {
          // Unique collision on sale_number — retry with next sequence.
        }
      }
      if (!saleId) throw new Error("SALE_NUMBER_COLLISION");

      let cogs = new Decimal(0);
      for (const l of totals.lines) {
        await tx.insert(saleDetails).values({
          saleId,
          itemId: l.itemId,
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: new Decimal(l.manualDiscount ?? "0").plus(l.promoDiscount).toFixed(2),
          taxRateApplied: l.isTaxExempt ? "0" : l.taxRate,
          lineTotal: l.lineTotal,
        });
        const [batch] = await tx
          .select({
            currentStockQuantity: items.currentStockQuantity,
            purchasePrice: items.purchasePrice,
          })
          .from(items)
          .where(eq(items.id, l.itemId))
          .limit(1);
        cogs = cogs.plus(new Decimal(batch?.purchasePrice ?? "0").times(l.quantity));
        await tx
          .update(items)
          .set({ currentStockQuantity: (batch?.currentStockQuantity ?? 0) - l.quantity })
          .where(eq(items.id, l.itemId));
      }

      if (cart) {
        await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));
      }

      // GL auto-posting: Dr cash/bank, Cr revenue + tax payable, Dr COGS / Cr inventory. Revenue absorbs
      // Kyat rounding so the entry always balances.
      const revenue = new Decimal(totals.grandTotal).minus(totals.tax).toFixed(2);
      const debitAccount = "1000";
      await postJournal(
        {
          branchId: session.user.branchId,
          refType: "sale",
          refId: saleId,
          memo: `Sale ${saleNumber}`,
          lines: [
            ...(remainder.gt(0)
              ? [{ accountCode: debitAccount, debit: remainder.toFixed(2) }]
              : []),
            { accountCode: "4000", credit: revenue },
            { accountCode: "2100", credit: new Decimal(totals.tax).toFixed(2) },
            { accountCode: "5000", debit: cogs.toFixed(2) },
            { accountCode: "1200", credit: cogs.toFixed(2) },
          ],
          createdBy: session.user.id,
        },
        tx,
      );

      return { saleId, saleNumber };
    });

    await audit({
      entityType: "Sale",
      entityId: receipt.saleId,
      action: "create",
      description: `Completed sale ${receipt.saleNumber} (${body.paymentMethod})`,
      newValues: {
        saleNumber: receipt.saleNumber,
        grandTotal: totals.grandTotal,
      },
      userId: session.user.id,
      branchId: session.user.branchId,
      ipAddress: await getClientIp(),
    });

    return NextResponse.json(
      {
        ok: true,
        sale: { id: receipt.saleId, saleNumber: receipt.saleNumber },
        totals,
      },
      { status: 201 },
    );
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === "INSUFFICIENT_STOCK" ||
        err.message === "SALE_NUMBER_COLLISION" ||
        err.message === "MOBILE_TXN_DUPLICATE")
    ) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 409 });
    }
    throw err;
  }
}
