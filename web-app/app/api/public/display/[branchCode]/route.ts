import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { branches, saleDetails, sales } from "@/db/schema";

// Customer-facing display feed (public, polled): latest completed sale
// totals only — no line detail, no customer data.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ branchCode: string }> },
) {
  const { branchCode } = await params;

  const [branch] = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.code, branchCode.toUpperCase()))
    .limit(1);
  if (!branch) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const [latest] = await db
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      grandTotal: sales.grandTotal,
      saleDate: sales.saleDate,
    })
    .from(sales)
    .where(and(eq(sales.branchId, branch.id), eq(sales.status, "completed")))
    .orderBy(desc(sales.saleDate))
    .limit(1);

  let itemCount: number | null = null;
  if (latest) {
    const lines = await db
      .select({ quantity: saleDetails.quantity })
      .from(saleDetails)
      .where(eq(saleDetails.saleId, latest.id));
    itemCount = lines.reduce((s, l) => s + l.quantity, 0);
  }

  return NextResponse.json({
    ok: true,
    display: {
      branchName: branch.name,
      saleNumber: latest?.saleNumber ?? null,
      grandTotal: latest?.grandTotal ?? null,
      itemCount,
      saleDate: latest?.saleDate ?? null,
    },
  });
}
