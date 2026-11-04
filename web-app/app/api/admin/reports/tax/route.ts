import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import { saleDetails, sales } from "@/db/schema";
import { getSession } from "@/lib/auth";

// Tax report: collected tax grouped by the snapshot rate actually charged
// (Sale_Detail.tax_rate_applied), so later Category.tax_rate edits never
// rewrite history. Tax derives as lineTotal × rate/(100+rate).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams;
  const branchId = q.get("branchId") ?? session.user.branchId;
  const startDate = q.get("startDate");
  const endDate = q.get("endDate");

  const conditions = [eq(sales.status, "completed"), eq(sales.branchId, branchId)];
  if (startDate) conditions.push(gte(sales.saleDate, new Date(startDate)));
  if (endDate) conditions.push(lte(sales.saleDate, new Date(endDate)));

  const rows = await db
    .select({
      taxRate: saleDetails.taxRateApplied,
      lines: sql<string>`count(*)`,
      revenue: sql<string>`coalesce(sum(${saleDetails.lineTotal}), 0)`,
    })
    .from(saleDetails)
    .leftJoin(sales, eq(saleDetails.saleId, sales.id))
    .where(and(...conditions))
    .groupBy(saleDetails.taxRateApplied);

  let totalRevenue = new Decimal(0);
  let totalTax = new Decimal(0);
  const byRate = rows.map((r) => {
    const revenue = new Decimal(r.revenue);
    const rate = new Decimal(r.taxRate || "0");
    const tax = rate.eq(0)
      ? new Decimal(0)
      : revenue.times(rate).div(rate.plus(100)).toDecimalPlaces(2);
    const taxable = revenue.minus(tax).toDecimalPlaces(2);
    totalRevenue = totalRevenue.plus(revenue);
    totalTax = totalTax.plus(tax);
    return {
      taxRate: r.taxRate,
      lines: r.lines,
      revenue: revenue.toFixed(2),
      taxable: taxable.toFixed(2),
      tax: tax.toFixed(2),
    };
  });

  // ?detail=true — invoice-level rows for e-invoice / IRD filing export.
  // Provisional format (have an accountant verify against current IRD
  // e-invoicing specs before statutory filing).
  if (q.get("detail") === "true") {
    const invoices = await db
      .select({
        saleNumber: sales.saleNumber,
        saleDate: sales.saleDate,
        paymentMethod: sales.paymentMethod,
        subtotal: sales.subtotal,
        discountAmount: sales.discountAmount,
        tax: sales.tax,
        grandTotal: sales.grandTotal,
      })
      .from(sales)
      .where(and(...conditions));
    return NextResponse.json({
      ok: true,
      byRate,
      totals: {
        revenue: totalRevenue.toFixed(2),
        taxable: totalRevenue.minus(totalTax).toFixed(2),
        tax: totalTax.toFixed(2),
      },
      invoices: invoices.map((s) => ({
        ...s,
        taxable: new Decimal(s.grandTotal).minus(s.tax).toFixed(2),
      })),
    });
  }

  return NextResponse.json({
    ok: true,
    byRate,
    totals: {
      revenue: totalRevenue.toFixed(2),
      taxable: totalRevenue.minus(totalTax).toFixed(2),
      tax: totalTax.toFixed(2),
    },
  });
}
