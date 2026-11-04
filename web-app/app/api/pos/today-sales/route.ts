import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, gte } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import { sales } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { page, pageSize } = getPaginationParams(new URL(req.url).searchParams);
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      grandTotal: sales.grandTotal,
      paymentMethod: sales.paymentMethod,
      status: sales.status,
      saleDate: sales.saleDate,
    })
    .from(sales)
    .where(
      and(
        eq(sales.branchId, session.user.branchId),
        session.user.role === "admin" ? undefined : eq(sales.createdBy, session.user.id),
        gte(sales.saleDate, start),
      ),
    )
    .orderBy(desc(sales.saleDate));

  const completed = rows.filter((r) => r.status === "completed");
  const total = completed.reduce((s, r) => s.plus(new Decimal(r.grandTotal)), new Decimal(0));
  const result = paginateArray(rows, page, pageSize);

  return NextResponse.json({
    ok: true,
    sales: result.items,
    ...result.pagination,
    count: completed.length,
    total: total.toFixed(2),
  });
}
