import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import { expenseBudgets, expenseCategories, expenses } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

// Budget variance per category for one month: limit vs actual + over flag.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams;
  const { page, pageSize } = getPaginationParams(q);
  const month =
    q.get("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ ok: false, error: "INVALID_MONTH" }, { status: 400 });
  }
  const branchId = q.get("branchId") ?? session.user.branchId;

  const start = new Date(`${month}-01T00:00:00`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  const budgets = await db
    .select({
      categoryId: expenseBudgets.categoryId,
      categoryName: expenseCategories.name,
      limitAmount: expenseBudgets.limitAmount,
    })
    .from(expenseBudgets)
    .leftJoin(
      expenseCategories,
      and(eq(expenseBudgets.categoryId, expenseCategories.id), eq(expenseCategories.isDeleted, false)),
    )
    .where(and(eq(expenseBudgets.branchId, branchId), eq(expenseBudgets.month, month)));

  const spent = await db
    .select({
      categoryId: expenses.categoryId,
      total: sql<string>`coalesce(sum(${expenses.amount}), 0)`,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.branchId, branchId),
        gte(expenses.expenseDate, start),
        lt(expenses.expenseDate, end),
      ),
    )
    .groupBy(expenses.categoryId);
  const spentByCat = new Map(spent.map((s) => [s.categoryId, new Decimal(s.total)]));

  const rows = budgets.map((b) => {
    const actual = spentByCat.get(b.categoryId) ?? new Decimal(0);
    const limit = new Decimal(b.limitAmount);
    return {
      categoryId: b.categoryId,
      categoryName: b.categoryName,
      limit: limit.toFixed(2),
      actual: actual.toFixed(2),
      remaining: limit.minus(actual).toFixed(2),
      pctUsed: limit.gt(0) ? Number(actual.div(limit).times(100).toFixed(1)) : 0,
      over: actual.greaterThan(limit),
    };
  });

  const result = paginateArray(rows, page, pageSize);
  return NextResponse.json({ ok: true, month, variance: result.items, ...result.pagination });
}
