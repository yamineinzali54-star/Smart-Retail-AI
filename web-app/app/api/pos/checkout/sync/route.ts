import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import Decimal from "decimal.js";

import { db } from "@/db";
import {
  branches,
  categories,
  items,
  notifications,
  products,
  saleDetails,
  sales,
} from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildSaleNumber } from "@/lib/numbers";
import { computeCartTotals, getActivePromos, type PosCartLine } from "@/lib/pos";

const queuedSaleSchema = z.object({
  tempId: z.string().max(100),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        itemId: z.string().uuid(),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1),
  paymentMethod: z.enum(["cash", "card", "mobile"]),
  cashReceived: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  cardNumber: z.string().min(4).max(32).optional(),
  paymentReference: z.string().max(100).optional(),
  mobileProvider: z.enum(["WavePay", "KBZPay", "CBPay", "AYAPay", "OnePay"]).optional(),
  mobileTransactionId: z.string().trim().min(1).max(100).optional(),
});

const syncSchema = z.object({
  posSessionId: z.string().uuid(),
  sales: z.array(queuedSaleSchema).min(1).max(50),
});

// POST — replay offline-queued sales (§4 R21): re-validate stock per line.
// Short stock never silently discards the sale — it is flagged for manager
// review (sync_conflict notification) since the physical sale happened.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = syncSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [branch] = await db
    .select({
      code: branches.code,
      roundingUnit: branches.roundingUnit,
    })
    .from(branches)
    .where(eq(branches.id, session.user.branchId))
    .limit(1);
  const promos = await getActivePromos(session.user.branchId);

  const results: Array<{ tempId: string; status: string; saleNumber?: string }> = [];

  for (const queued of parsed.data.sales) {
    // Build priced lines from live batch data.
    const priced: PosCartLine[] = [];
    let conflict: string | null = null;
    for (const l of queued.lines) {
      const [batch] = await db
        .select()
        .from(items)
        .where(and(eq(items.id, l.itemId), eq(items.branchId, session.user.branchId)))
        .limit(1);
      if (!batch || (batch.currentStockQuantity ?? 0) < l.quantity) {
        conflict = "INSUFFICIENT_STOCK";
        break;
      }
      const [prod] = await db
        .select({ categoryId: products.categoryId })
        .from(products)
        .where(and(eq(products.id, l.productId), eq(products.isDeleted, false)))
        .limit(1);
      if (!prod) {
        conflict = "PRODUCT_NOT_FOUND";
        break;
      }
      const [cat] = prod
        ? await db
            .select({ taxRate: categories.taxRate, isTaxExempt: categories.isTaxExempt })
            .from(categories)
            .where(and(eq(categories.id, prod.categoryId), eq(categories.isDeleted, false)))
            .limit(1)
        : [];
      priced.push({
        productId: l.productId,
        itemId: l.itemId,
        quantity: l.quantity,
        unitPrice: batch.sellingPrice,
        categoryId: prod?.categoryId ?? "",
        taxRate: cat?.taxRate ?? "0",
        isTaxExempt: cat?.isTaxExempt ?? false,
      });
    }
    if (conflict) {
      await db.insert(notifications).values({
        branchId: session.user.branchId,
        userId: null,
        type: "sync_conflict",
        title: "Offline sale needs review",
        message: `Queued sale ${queued.tempId} failed stock re-validation (${conflict}).`,
      });
      results.push({ tempId: queued.tempId, status: conflict });
      continue;
    }

    const totals = computeCartTotals(priced, promos, branch?.roundingUnit ?? 50);

    if (queued.paymentMethod === "cash") {
      if (!queued.cashReceived || new Decimal(queued.cashReceived).lt(new Decimal(totals.grandTotal))) {
        results.push({ tempId: queued.tempId, status: "CASH_INSUFFICIENT" });
        continue;
      }
    }
    if (queued.paymentMethod === "card" && (queued.cardNumber ?? "").replace(/\D/g, "").length < 4) {
      results.push({ tempId: queued.tempId, status: "CARD_NUMBER_REQUIRED" });
      continue;
    }
    if (queued.paymentMethod === "mobile") {
      if (!queued.mobileProvider) {
        results.push({ tempId: queued.tempId, status: "MOBILE_PROVIDER_REQUIRED" });
        continue;
      }
      if (!queued.mobileTransactionId?.trim()) {
        results.push({ tempId: queued.tempId, status: "MOBILE_TXN_ID_REQUIRED" });
        continue;
      }
    }
    try {
      const saleNumber = await db.transaction(async (tx) => {
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
        const dayCount = (
          await tx.select({ id: sales.id }).from(sales).where(eq(sales.branchId, session.user.branchId))
        ).length;
        const candidate = buildSaleNumber(branch?.code ?? "BR", new Date(), dayCount + 1);
        const digits = (queued.cardNumber ?? "").replace(/\D/g, "");
        const [sale] = await tx
          .insert(sales)
          .values({
            branchId: session.user.branchId,
            saleNumber: candidate,
            posSessionId: parsed.data.posSessionId,
            subtotal: totals.subtotal,
            discountAmount: totals.discountAmount,
            tax: totals.tax,
            totalAmount: totals.totalAmount,
            roundingAdjustment: totals.roundingAdjustment,
            grandTotal: totals.grandTotal,
            paymentMethod: queued.paymentMethod,
            paymentReference: queued.paymentReference?.trim() ?? null,
            mobileProvider: queued.mobileProvider ?? null,
            mobileTransactionId: queued.mobileTransactionId?.trim() ?? null,
            cashReceived: queued.cashReceived ?? null,
            cardLast4: queued.paymentMethod === "card" ? digits.slice(-4) : null,
            status: "completed",
            notes: `Offline sync (temp ${queued.tempId})`,
            createdBy: session.user.id,
          })
          .returning({ saleNumber: sales.saleNumber, id: sales.id });
        for (const l of totals.lines) {
          await tx.insert(saleDetails).values({
            saleId: sale.id,
            itemId: l.itemId,
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discount: new Decimal(l.manualDiscount ?? "0").plus(l.promoDiscount).toFixed(2),
            taxRateApplied: l.isTaxExempt ? "0" : l.taxRate,
            lineTotal: l.lineTotal,
          });
          const [batch] = await tx
            .select({ currentStockQuantity: items.currentStockQuantity })
            .from(items)
            .where(eq(items.id, l.itemId))
            .limit(1);
          await tx
            .update(items)
            .set({ currentStockQuantity: (batch?.currentStockQuantity ?? 0) - l.quantity })
            .where(eq(items.id, l.itemId));
        }
        return sale.saleNumber;
      });

      await audit({
        entityType: "Sale",
        entityId: saleNumber,
        action: "create",
        description: `Synced offline sale ${saleNumber} (temp ${queued.tempId})`,
        userId: session.user.id,
        branchId: session.user.branchId,
        ipAddress: await getClientIp(),
      });
      results.push({ tempId: queued.tempId, status: "synced", saleNumber });
    } catch {
      await db.insert(notifications).values({
        branchId: session.user.branchId,
        userId: null,
        type: "sync_conflict",
        title: "Offline sale needs review",
        message: `Queued sale ${queued.tempId} failed during sync replay.`,
      });
      results.push({ tempId: queued.tempId, status: "SYNC_FAILED" });
    }
  }

  return NextResponse.json({ ok: true, results });
}
