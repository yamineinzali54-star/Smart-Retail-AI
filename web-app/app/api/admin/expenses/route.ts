import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, gte, lt, lte } from "drizzle-orm";
import { z } from "zod";
import Decimal from "decimal.js";

import { db } from "@/db";
import { expenseBudgets, expenseCategories, expenses, pettyCashFloats } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { postJournal } from "@/lib/gl";

const createSchema = z.object({
  categoryId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  expenseDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid date"),
  method: z.enum(["cash", "bank_transfer", "mobile_payment"]).default("cash"),
  notes: z.string().max(255).optional(),
  floatId: z.string().uuid().optional(),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 100));
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  const conditions = [eq(expenses.branchId, session.user.branchId)];
  if (startDate) conditions.push(gte(expenses.expenseDate, new Date(startDate)));
  if (endDate) conditions.push(lte(expenses.expenseDate, new Date(endDate)));

  const rows = await db
    .select({
      id: expenses.id,
      categoryId: expenses.categoryId,
      categoryName: expenseCategories.name,
      floatId: expenses.floatId,
      amount: expenses.amount,
      expenseDate: expenses.expenseDate,
      method: expenses.method,
      notes: expenses.notes,
    })
    .from(expenses)
    .leftJoin(
      expenseCategories,
      and(eq(expenses.categoryId, expenseCategories.id), eq(expenseCategories.isDeleted, false)),
    )
    .where(and(...conditions))
    .orderBy(desc(expenses.expenseDate))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, expenses: rows, page, pageSize });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (new Decimal(parsed.data.amount).lte(0)) {
    return NextResponse.json({ ok: false, error: "AMOUNT_MUST_BE_POSITIVE" }, { status: 400 });
  }

  const [category] = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(
      and(
        eq(expenseCategories.id, parsed.data.categoryId),
        eq(expenseCategories.branchId, session.user.branchId),
        eq(expenseCategories.isDeleted, false),
      ),
    )
    .limit(1);
  if (!category) {
    return NextResponse.json({ ok: false, error: "CATEGORY_NOT_FOUND" }, { status: 404 });
  }

  let float: { id: string } | undefined;
  if (parsed.data.floatId) {
    [float] = await db
      .select({ id: pettyCashFloats.id })
      .from(pettyCashFloats)
      .where(
        and(
          eq(pettyCashFloats.id, parsed.data.floatId),
          eq(pettyCashFloats.branchId, session.user.branchId),
          eq(pettyCashFloats.status, "open"),
        ),
      )
      .limit(1);
    if (!float) {
      return NextResponse.json({ ok: false, error: "FLOAT_NOT_FOUND_OR_CLOSED" }, { status: 404 });
    }
  }

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(expenses)
      .values({
        branchId: session.user.branchId,
        categoryId: parsed.data.categoryId,
        floatId: float?.id ?? null,
        amount: new Decimal(parsed.data.amount).toFixed(2),
        expenseDate: new Date(parsed.data.expenseDate),
        method: parsed.data.method,
        notes: parsed.data.notes ?? null,
        recordedBy: session.user.id,
      })
      .returning();

    // GL auto-posting: Dr Operating Expenses / Cr cash (or bank).
    await postJournal(
      {
        branchId: session.user.branchId,
        entryDate: new Date(parsed.data.expenseDate),
        refType: "expense",
        refId: inserted.id,
        memo: `Expense ${parsed.data.amount}${float ? " (petty cash)" : ""}`,
        lines: [
          { accountCode: "5100", debit: new Decimal(parsed.data.amount).toFixed(2) },
          {
            accountCode: parsed.data.method === "cash" ? "1000" : "1010",
            credit: new Decimal(parsed.data.amount).toFixed(2),
          },
        ],
        createdBy: session.user.id,
      },
      tx,
    );
    return inserted;
  });

  // Over-budget warning (non-blocking, like supplier OVERPAYMENT).
  let warning: string | null = null;
  const expenseMonth = new Date(parsed.data.expenseDate).toISOString().slice(0, 7);
  const [budget] = await db
    .select({ limitAmount: expenseBudgets.limitAmount })
    .from(expenseBudgets)
    .where(
      and(
        eq(expenseBudgets.branchId, session.user.branchId),
        eq(expenseBudgets.categoryId, parsed.data.categoryId),
        eq(expenseBudgets.month, expenseMonth),
      ),
    )
    .limit(1);
  if (budget) {
    const monthStart = new Date(`${expenseMonth}-01T00:00:00`);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    const spent = await db
      .select({ amount: expenses.amount })
      .from(expenses)
      .where(
        and(
          eq(expenses.branchId, session.user.branchId),
          eq(expenses.categoryId, parsed.data.categoryId),
          gte(expenses.expenseDate, monthStart),
          lt(expenses.expenseDate, monthEnd),
        ),
      );
    const total = spent.reduce((s, r) => s.plus(r.amount), new Decimal(0));
    if (total.greaterThan(new Decimal(budget.limitAmount))) {
      warning = "OVER_BUDGET";
    }
  }

  await audit({
    entityType: "Expense",
    entityId: row.id,
    action: "create",
    description: `Recorded expense ${row.amount} (${parsed.data.method})`,
    newValues: row,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, expense: row, warning }, { status: 201 });
}
