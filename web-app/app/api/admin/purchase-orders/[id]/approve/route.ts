import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { purchaseOrders } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

// Approve a pending PO (admin only) — GRN is blocked until approval when
// the branch approval gate applies (Batch 2 #12).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { id } = await params;

  const [po] = await db
    .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, approvalStatus: purchaseOrders.approvalStatus })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.branchId, session.user.branchId)))
    .limit(1);
  if (!po) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  if (po.approvalStatus !== "pending") {
    return NextResponse.json({ ok: false, error: "ALREADY_DECIDED" }, { status: 400 });
  }

  const [updated] = await db
    .update(purchaseOrders)
    .set({ approvalStatus: "approved", approvedBy: session.user.id, updatedAt: new Date() })
    .where(eq(purchaseOrders.id, id))
    .returning({ id: purchaseOrders.id });

  await audit({
    entityType: "PurchaseOrder",
    entityId: id,
    action: "approve",
    description: `Approved PO: ${po.poNumber}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, purchaseOrder: updated });
}
