import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { expenseCategories } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { page, pageSize } = getPaginationParams(new URL(req.url).searchParams);
  const rows = await db
    .select()
    .from(expenseCategories)
    .where(
      and(
        eq(expenseCategories.branchId, session.user.branchId),
        eq(expenseCategories.isDeleted, false),
      ),
    );
  const result = paginateArray(rows, page, pageSize);
  return NextResponse.json({ ok: true, categories: result.items, ...result.pagination });
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
  const [row] = await db
    .insert(expenseCategories)
    .values({ branchId: session.user.branchId, name: parsed.data.name })
    .returning();

  await audit({
    entityType: "ExpenseCategory",
    entityId: row.id,
    action: "create",
    description: `Created expense category: ${parsed.data.name}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, category: row }, { status: 201 });
}
