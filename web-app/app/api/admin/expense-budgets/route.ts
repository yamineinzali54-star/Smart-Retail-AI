import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import Decimal from "decimal.js";

import { db } from "@/db";
import { expenseBudgets, expenseCategories } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

const upsertSchema = z.object({
  categoryId: z.string().uuid(),
  // YYYY-MM
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  limitAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const searchParams = new URL(req.url).searchParams;
  const month = searchParams.get("month");
  const { page, pageSize } = getPaginationParams(searchParams);
  const conditions = [eq(expenseBudgets.branchId, session.user.branchId)];
  if (month) conditions.push(eq(expenseBudgets.month, month));

  const rows = await db
    .select({
      id: expenseBudgets.id,
      categoryId: expenseBudgets.categoryId,
      categoryName: expenseCategories.name,
      month: expenseBudgets.month,
      limitAmount: expenseBudgets.limitAmount,
    })
    .from(expenseBudgets)
    .leftJoin(
      expenseCategories,
      and(eq(expenseBudgets.categoryId, expenseCategories.id), eq(expenseCategories.isDeleted, false)),
    )
    .where(and(...conditions));

  const result = paginateArray(rows, page, pageSize);
  return NextResponse.json({ ok: true, budgets: result.items, ...result.pagination });
}

// Upsert one budget row per branch + category + month.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = upsertSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (new Decimal(parsed.data.limitAmount).lte(0)) {
    return NextResponse.json({ ok: false, error: "LIMIT_MUST_BE_POSITIVE" }, { status: 400 });
  }

  const [category] = await db
    .select({ id: expenseCategories.id, name: expenseCategories.name })
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

  const [row] = await db
    .insert(expenseBudgets)
    .values({
      branchId: session.user.branchId,
      categoryId: parsed.data.categoryId,
      month: parsed.data.month,
      limitAmount: new Decimal(parsed.data.limitAmount).toFixed(2),
    })
    .onConflictDoUpdate({
      target: [
        expenseBudgets.branchId,
        expenseBudgets.categoryId,
        expenseBudgets.month,
      ],
      set: {
        limitAmount: new Decimal(parsed.data.limitAmount).toFixed(2),
        updatedAt: new Date(),
      },
    })
    .returning();

  await audit({
    entityType: "ExpenseBudget",
    entityId: row.id,
    action: "create",
    description: `Set budget ${category.name} ${parsed.data.month} = ${parsed.data.limitAmount}`,
    newValues: row,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, budget: row }, { status: 201 });
}
