import "server-only";

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { groundBalanceDetails, groundBalances, items, products } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const updateGroundBalanceSchema = z.object({
  status: z.enum(["pending", "completed", "cancelled"]).optional(),
  remark: z.string().max(100).optional().nullable(),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        actualQty: z.number().int().min(0),
        remark: z.string().max(100).optional(),
      }),
    )
    .optional(),
});

async function requireBranchGB(batchNo: string, branchId: string) {
  const [gb] = await db
    .select()
    .from(groundBalances)
    .where(and(eq(groundBalances.batchNo, batchNo), eq(groundBalances.branchId, branchId)))
    .limit(1);
  return gb;
}

export async function GET(_req: Request, { params }: { params: Promise<{ batchNo: string }> }) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { batchNo } = await params;
  const gb = await requireBranchGB(batchNo, session.user.branchId);
  if (!gb) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const details = await db
    .select({
      id: groundBalanceDetails.id,
      itemId: groundBalanceDetails.itemId,
      productName: products.name,
      barcode: items.barcode,
      actualQty: groundBalanceDetails.actualQty,
      inventoryQty: groundBalanceDetails.inventoryQty,
      differenceQty: groundBalanceDetails.differenceQty,
      remark: groundBalanceDetails.remark,
    })
    .from(groundBalanceDetails)
    .leftJoin(items, eq(groundBalanceDetails.itemId, items.id))
    .innerJoin(products, and(eq(items.productId, products.id), eq(products.isDeleted, false)))
    .where(eq(groundBalanceDetails.batchNo, batchNo));

  return NextResponse.json({ ok: true, groundBalance: { ...gb, details } });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ batchNo: string }> }) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { batchNo } = await params;
  const parsed = updateGroundBalanceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const gb = await requireBranchGB(batchNo, session.user.branchId);
  if (!gb) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const { status, remark, lines } = parsed.data;

  // Edit wipes and re-inserts detail lines (legacy semantics, §3.2).
  const updated = await db.transaction(async (tx) => {
    if (lines) {
      const itemIds = [...new Set(lines.map((l) => l.itemId))];
      const branchItems = await tx
        .select({ id: items.id, currentStockQuantity: items.currentStockQuantity })
        .from(items)
        .where(and(inArray(items.id, itemIds), eq(items.branchId, session.user.branchId)));
      if (branchItems.length !== itemIds.length) {
        throw new Error("ITEM_NOT_FOUND");
      }
      const stockByItem = new Map(branchItems.map((i) => [i.id, i.currentStockQuantity ?? 0]));
      await tx.delete(groundBalanceDetails).where(eq(groundBalanceDetails.batchNo, batchNo));
      await tx.insert(groundBalanceDetails).values(
        lines.map((line) => {
          const inventoryQty = stockByItem.get(line.itemId) ?? 0;
          return {
            batchNo,
            itemId: line.itemId,
            actualQty: line.actualQty,
            inventoryQty,
            differenceQty: line.actualQty - inventoryQty,
            remark: line.remark ?? null,
          };
        }),
      );
    }

    const updates: Partial<typeof groundBalances.$inferInsert> = {
      updatedBy: session.user.id,
    };
    if (status !== undefined) updates.status = status;
    if (remark !== undefined) updates.remark = remark;

    const [row] = await tx
      .update(groundBalances)
      .set(updates)
      .where(eq(groundBalances.batchNo, batchNo))
      .returning();
    return row;
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message === "ITEM_NOT_FOUND") return null;
    throw err;
  });
  if (!updated) {
    return NextResponse.json({ ok: false, error: "ITEM_NOT_FOUND" }, { status: 404 });
  }

  await audit({
    entityType: "GroundBalance",
    entityId: batchNo,
    action: "edit",
    description: `Updated ground balance: ${batchNo}`,
    oldValues: { status: gb.status, remark: gb.remark },
    newValues: parsed.data,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, groundBalance: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ batchNo: string }> }) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { batchNo } = await params;
  const gb = await requireBranchGB(batchNo, session.user.branchId);
  if (!gb) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  await db.transaction(async (tx) => {
    await tx.delete(groundBalanceDetails).where(eq(groundBalanceDetails.batchNo, batchNo));
    await tx.delete(groundBalances).where(eq(groundBalances.batchNo, batchNo));
  });

  await audit({
    entityType: "GroundBalance",
    entityId: batchNo,
    action: "delete",
    description: `Deleted ground balance: ${batchNo}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true });
}
