import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { grns, items, poDetails, purchaseOrders } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ poId: string }> },
) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { poId } = await params;
  const { page, pageSize } = getPaginationParams(new URL(req.url).searchParams);

  const [po] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.id, poId),
        eq(purchaseOrders.branchId, session.user.branchId),
      ),
    )
    .limit(1);
  if (!po) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const history = await db
    .select()
    .from(grns)
    .where(
      and(eq(grns.poId, poId), eq(grns.branchId, session.user.branchId)),
    )
    .orderBy(desc(grns.receivedDate));
  const result = paginateArray(history, page, pageSize);

  const poLines = await db.select().from(poDetails).where(eq(poDetails.poId, poId));
  const allItems = await db
    .select({ productId: items.productId, receivedQuantity: items.receivedQuantity })
    .from(items)
    .where(eq(items.poId, poId));
  const receivedByProduct: Record<string, number> = {};
  for (const row of allItems) {
    receivedByProduct[row.productId] =
      (receivedByProduct[row.productId] ?? 0) + row.receivedQuantity;
  }
  const alreadyReceived = poLines.map((l) => ({
    productId: l.productId,
    orderedQuantity: l.quantity,
    receivedQuantity: receivedByProduct[l.productId] ?? 0,
  }));

  return NextResponse.json({ ok: true, history: result.items, alreadyReceived, ...result.pagination });
}
