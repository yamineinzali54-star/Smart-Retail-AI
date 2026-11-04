import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { purchaseOrders } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const rejectSchema = z.object({
  reason: z.string().trim().min(1).max(255).optional(),
});

// Reject a pending PO (admin only). Rejected POs cannot receive GRNs.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { id } = await params;

  const parsed = rejectSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

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
    .set({ approvalStatus: "rejected", updatedAt: new Date() })
    .where(eq(purchaseOrders.id, id))
    .returning({ id: purchaseOrders.id });

  await audit({
    entityType: "PurchaseOrder",
    entityId: id,
    action: "update",
    description: `Rejected PO: ${po.poNumber}${parsed.data.reason ? ` — ${parsed.data.reason}` : ""}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, purchaseOrder: updated });
}
