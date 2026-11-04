import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { items } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const writeOffSchema = z.object({
  reason: z.string().trim().min(1).max(255),
});

// §4 R13 — write-off zeroes stock, requires a reason, audits `write_off`.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { itemId } = await params;

  const parsed = writeOffSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [batch] = await db
    .select({ id: items.id, barcode: items.barcode, currentStockQuantity: items.currentStockQuantity })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.branchId, session.user.branchId)))
    .limit(1);
  if (!batch) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  await db
    .update(items)
    .set({ currentStockQuantity: 0, updatedAt: new Date() })
    .where(eq(items.id, itemId));

  await audit({
    entityType: "Item",
    entityId: itemId,
    action: "write_off",
    description: `Wrote off batch ${batch.barcode}: ${parsed.data.reason}`,
    oldValues: { currentStockQuantity: batch.currentStockQuantity },
    newValues: { currentStockQuantity: 0, reason: parsed.data.reason },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true });
}
