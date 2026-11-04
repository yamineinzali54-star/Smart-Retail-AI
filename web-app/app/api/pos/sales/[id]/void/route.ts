import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { items, saleDetails, sales } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { getActiveSession } from "@/lib/pos";
import { reverseJournal } from "@/lib/gl";

const voidSchema = z.object({
  reason: z.string().trim().min(1).max(255),
});

// POST — Void Sale (§4 R11, §6.8 step 4): same open session → free;
// different/closed session → requires void.approve. Recorded as voided,
// never as a Sale Return.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = voidSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { id } = await params;

  const [sale] = await db
    .select()
    .from(sales)
    .where(and(eq(sales.id, id), eq(sales.branchId, session.user.branchId)))
    .limit(1);
  if (!sale) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  if (sale.status !== "completed") {
    return NextResponse.json({ ok: false, error: "SALE_NOT_VOIDABLE" }, { status: 400 });
  }

  const active = await getActiveSession(session.user.id);
  const sameSession = active !== null && active.id === sale.posSessionId && active.status === "active";
  if (!sameSession && !(await hasPermission(session.user.role, "void.approve"))) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const lines = await db.select().from(saleDetails).where(eq(saleDetails.saleId, id));

  await db.transaction(async (tx) => {
    for (const line of lines) {
      const [batch] = await tx
        .select({ currentStockQuantity: items.currentStockQuantity })
        .from(items)
        .where(eq(items.id, line.itemId))
        .limit(1);
      await tx
        .update(items)
        .set({ currentStockQuantity: (batch?.currentStockQuantity ?? 0) + line.quantity })
        .where(eq(items.id, line.itemId));
    }
    await tx
      .update(sales)
      .set({ status: "voided", voidReason: parsed.data.reason })
      .where(eq(sales.id, id));

    // GL auto-posting: exact reversal of the original sale entry.
    await reverseJournal(
      "sale",
      id,
      {
        branchId: session.user.branchId,
        memo: `Void of sale ${sale.saleNumber}: ${parsed.data.reason}`,
        createdBy: session.user.id,
      },
      tx,
    );
  });

  await audit({
    entityType: "Sale",
    entityId: id,
    action: "void",
    description: `Voided sale ${sale.saleNumber}: ${parsed.data.reason}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true });
}
