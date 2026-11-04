import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import { grns, items, products } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

// Stock aging: how long capital has sat on shelves. Age counts from GRN
// receipt (batches without a GRN use their creation date). Buckets:
// 0–30 / 31–60 / 61–90 / 90+ days, with locked cost value per bucket.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const searchParams = new URL(req.url).searchParams;
  const branchId = searchParams.get("branchId") ?? session.user.branchId;
  const { page, pageSize } = getPaginationParams(searchParams);
  const now = Date.now();
  const DAY = 86_400_000;

  const rows = await db
    .select({
      id: items.id,
      barcode: items.barcode,
      productName: products.name,
      currentStockQuantity: items.currentStockQuantity,
      purchasePrice: items.purchasePrice,
      receivedDate: grns.receivedDate,
      createdAt: items.createdAt,
    })
    .from(items)
    .innerJoin(products, and(eq(items.productId, products.id), eq(products.isDeleted, false)))
    .leftJoin(grns, eq(items.grnId, grns.id))
    .where(and(eq(items.branchId, branchId), gt(items.currentStockQuantity, 0)))
    .limit(2000);

  const buckets = [
    { label: "0–30 days", max: 30, batches: 0, stock: 0, costValue: new Decimal(0) },
    { label: "31–60 days", max: 60, batches: 0, stock: 0, costValue: new Decimal(0) },
    { label: "61–90 days", max: 90, batches: 0, stock: 0, costValue: new Decimal(0) },
    { label: "90+ days", max: Infinity, batches: 0, stock: 0, costValue: new Decimal(0) },
  ];

  const detail = rows.map((r) => {
    const base = r.receivedDate ? new Date(r.receivedDate).getTime() : new Date(r.createdAt).getTime();
    const ageDays = Math.max(0, Math.floor((now - base) / DAY));
    const bucket = buckets.find((b) => ageDays <= b.max)!;
    const cost = new Decimal(r.purchasePrice).times(r.currentStockQuantity ?? 0);
    bucket.batches += 1;
    bucket.stock += r.currentStockQuantity ?? 0;
    bucket.costValue = bucket.costValue.plus(cost);
    return {
      id: r.id,
      barcode: r.barcode,
      productName: r.productName,
      ageDays,
      bucket: bucket.label,
      stock: r.currentStockQuantity,
      costValue: cost.toFixed(2),
    };
  });

  detail.sort((a, b) => b.ageDays - a.ageDays);
  const result = paginateArray(detail, page, pageSize);

  return NextResponse.json({
    ok: true,
    buckets: buckets.map((b) => ({
      label: b.label,
      batches: b.batches,
      stock: b.stock,
      costValue: b.costValue.toFixed(2),
    })),
    batches: result.items,
    ...result.pagination,
  });
}
