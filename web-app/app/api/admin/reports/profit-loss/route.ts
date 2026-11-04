import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import { expenses, items, saleDetails, sales } from "@/db/schema";
import { getSession } from "@/lib/auth";

// P&L: revenue − COGS (batch purchase prices) − operating expenses = net.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams;
  const branchId = q.get("branchId") ?? session.user.branchId;
  const startDate = q.get("startDate");
  const endDate = q.get("endDate");

  const saleConditions = [eq(sales.status, "completed"), eq(sales.branchId, branchId)];
  if (startDate) saleConditions.push(gte(sales.saleDate, new Date(startDate)));
  if (endDate) saleConditions.push(lte(sales.saleDate, new Date(endDate)));

  const [rev] = await db
    .select({
      revenue: sql<string>`coalesce(sum(${sales.grandTotal}), 0)`,
      discounts: sql<string>`coalesce(sum(${sales.discountAmount}), 0)`,
      tax: sql<string>`coalesce(sum(${sales.tax}), 0)`,
    })
    .from(sales)
    .where(and(...saleConditions));

  const [cost] = await db
    .select({
      cogs: sql<string>`coalesce(sum(${saleDetails.quantity} * ${items.purchasePrice}), 0)`,
    })
    .from(saleDetails)
    .leftJoin(sales, eq(saleDetails.saleId, sales.id))
    .leftJoin(items, eq(saleDetails.itemId, items.id))
    .where(and(...saleConditions));

  const expConditions = [eq(expenses.branchId, branchId)];
  if (startDate) expConditions.push(gte(expenses.expenseDate, new Date(startDate)));
  if (endDate) expConditions.push(lte(expenses.expenseDate, new Date(endDate)));
  const expRows = await db
    .select({ amount: expenses.amount })
    .from(expenses)
    .where(and(...expConditions));
  const totalExpenses = expRows.reduce(
    (s, r) => s.plus(new Decimal(r.amount)),
    new Decimal(0),
  );

  const revenue = new Decimal(rev?.revenue ?? 0);
  const cogs = new Decimal(cost?.cogs ?? 0);
  const gross = revenue.minus(cogs);
  const net = gross.minus(totalExpenses);

  return NextResponse.json({
    ok: true,
    profitLoss: {
      revenue: revenue.toFixed(2),
      discounts: new Decimal(rev?.discounts ?? 0).toFixed(2),
      tax: new Decimal(rev?.tax ?? 0).toFixed(2),
      cogs: cogs.toFixed(2),
      grossProfit: gross.toFixed(2),
      expenses: totalExpenses.toFixed(2),
      netProfit: net.toFixed(2),
    },
  });
}
