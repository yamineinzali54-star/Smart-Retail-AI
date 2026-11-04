import "server-only";

import { and, eq, gte, lte } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import { posSessions, promotionProducts, promotions } from "@/db/schema";

// ---------------------------------------------------------------------------
// Shared POS helpers (§4 R6 checkout math, §4 R19/R20 sessions, §4 R25 rounding)
// ---------------------------------------------------------------------------

export interface PosCartLine {
  productId: string;
  itemId: string;
  quantity: number;
  unitPrice: string;
  categoryId: string;
  taxRate: string;
  isTaxExempt: boolean;
  /** Total manual discount for this line (already validated + permitted). */
  manualDiscount?: string;
}

export interface PosPromo {
  id: string;
  type: "percentage" | "fixed" | "bundle" | "seasonal";
  value: string;
  /** productId → required qty (bundle) or 1 (line promos). */
  products: Map<string, number>;
}

export interface PricedLine extends PosCartLine {
  base: string;
  promoDiscount: string;
  appliedPromotionId: string | null;
  taxable: string;
  lineTax: string;
  lineTotal: string;
}

export interface CartTotals {
  lines: PricedLine[];
  subtotal: string;
  discountAmount: string;
  tax: string;
  totalAmount: string;
  roundingAdjustment: string;
  grandTotal: string;
  itemCount: number;
}

/** Round to the nearest currency unit (Kyat rounding, §4 R25). */
export function roundToUnit(total: Decimal, unit: number): Decimal {
  if (!unit || unit <= 1) return total.toDecimalPlaces(2);
  return total.div(unit).round().times(unit).toDecimalPlaces(2);
}

/**
 * Checkout math, order of operations per §4 R6:
 * subtotal → line manual discount → bundle promo → seasonal/percentage/fixed
 * promo → per-line tax (snapshot rate) → rounding → grand total.
 * Manually discounted lines never stack with promos.
 */
export function computeCartTotals(
  lines: PosCartLine[],
  promos: PosPromo[],
  roundingUnit: number,
): CartTotals {
  const priced: PricedLine[] = lines.map((l) => {
    const base = new Decimal(l.unitPrice).times(l.quantity);
    return {
      ...l,
      manualDiscount: l.manualDiscount ?? "0",
      base: base.toFixed(2),
      promoDiscount: "0",
      appliedPromotionId: null,
      taxable: "0",
      lineTax: "0",
      lineTotal: "0",
    };
  });

  const linePromos = promos.filter((p) => p.type !== "bundle");
  const bundlePromos = promos.filter((p) => p.type === "bundle");

  // Quantities available for bundle qualification (all lines, incl. discounted —
  // bundles only need presence; discount still won't stack, see below).
  const qtyByProduct = new Map<string, number>();
  for (const l of priced) {
    qtyByProduct.set(l.productId, (qtyByProduct.get(l.productId) ?? 0) + l.quantity);
  }

  for (const line of priced) {
    const base = new Decimal(line.base);
    const manual = Decimal.min(new Decimal(line.manualDiscount ?? "0"), base);
    let promoDisc = new Decimal(0);
    let appliedId: string | null = null;

    if (manual.eq(0)) {
      // Bundle first: qualifies when the whole combination is present.
      for (const b of bundlePromos) {
        let qualifies = true;
        for (const [pid, req] of b.products) {
          if ((qtyByProduct.get(pid) ?? 0) < req) {
            qualifies = false;
            break;
          }
        }
        if (qualifies && b.products.has(line.productId)) {
          const pct = Decimal.min(new Decimal(b.value), 100);
          promoDisc = base.times(pct).div(100);
          appliedId = b.id;
          break;
        }
      }
      // Then the best single-line promo (percentage/seasonal/fixed).
      if (!appliedId) {
        let best = new Decimal(0);
        for (const p of linePromos) {
          if (!p.products.has(line.productId)) continue;
          let disc: Decimal;
          if (p.type === "fixed") {
            disc = Decimal.min(new Decimal(p.value), base);
          } else {
            const pct = Decimal.min(new Decimal(p.value), 100);
            disc = base.times(pct).div(100);
          }
          if (disc.greaterThan(best)) {
            best = disc;
            appliedId = p.id;
          }
        }
        promoDisc = best;
        if (promoDisc.eq(0)) appliedId = null;
      }
    }

    const taxable = base.minus(manual).minus(promoDisc);
    const rate = line.isTaxExempt ? new Decimal(0) : new Decimal(line.taxRate || "0").div(100);
    const lineTax = taxable.times(rate).toDecimalPlaces(2);
    const lineTotal = taxable.plus(lineTax).toDecimalPlaces(2);

    line.manualDiscount = manual.toFixed(2);
    line.promoDiscount = promoDisc.toDecimalPlaces(2).toFixed(2);
    line.appliedPromotionId = appliedId;
    line.taxable = taxable.toDecimalPlaces(2).toFixed(2);
    line.lineTax = lineTax.toFixed(2);
    line.lineTotal = lineTotal.toFixed(2);
  }

  const subtotal = priced.reduce((s, l) => s.plus(l.base), new Decimal(0));
  const discountAmount = priced.reduce(
    (s, l) => s.plus(l.manualDiscount ?? "0").plus(l.promoDiscount),
    new Decimal(0),
  );
  const tax = priced.reduce((s, l) => s.plus(l.lineTax), new Decimal(0));
  const totalAmount = subtotal.minus(discountAmount).plus(tax).toDecimalPlaces(2);
  const grandTotal = roundToUnit(totalAmount, roundingUnit);
  const roundingAdjustment = grandTotal.minus(totalAmount).toDecimalPlaces(2);

  return {
    lines: priced,
    subtotal: subtotal.toFixed(2),
    discountAmount: discountAmount.toDecimalPlaces(2).toFixed(2),
    tax: tax.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    roundingAdjustment: roundingAdjustment.toFixed(2),
    grandTotal: grandTotal.toFixed(2),
    itemCount: priced.reduce((s, l) => s + l.quantity, 0),
  };
}

/** Active (date-valid) promotions for a branch with their product links. */
export async function getActivePromos(branchId: string): Promise<PosPromo[]> {
  const now = new Date();
  const rows = await db
    .select({
      id: promotions.id,
      type: promotions.type,
      value: promotions.value,
      productId: promotionProducts.productId,
      requiredQuantity: promotionProducts.requiredQuantity,
    })
    .from(promotions)
    .leftJoin(promotionProducts, eq(promotions.id, promotionProducts.promotionId))
    .where(
      and(
        eq(promotions.branchId, branchId),
        eq(promotions.status, "active"),
        lte(promotions.startDate, now),
        gte(promotions.endDate, now),
      ),
    );
  const byId = new Map<string, PosPromo>();
  for (const r of rows) {
    let p = byId.get(r.id);
    if (!p) {
      p = { id: r.id, type: r.type, value: r.value, products: new Map() };
      byId.set(r.id, p);
    }
    if (r.productId) p.products.set(r.productId, r.requiredQuantity ?? 1);
  }
  return [...byId.values()];
}

/** The user's active POS session, if any. */
export async function getActiveSession(userId: string) {
  const [s] = await db
    .select()
    .from(posSessions)
    .where(and(eq(posSessions.userId, userId), eq(posSessions.status, "active")))
    .limit(1);
  return s ?? null;
}
