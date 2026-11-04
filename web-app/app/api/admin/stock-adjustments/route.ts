import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { branches, items, stockAdjustmentDetails, stockAdjustments } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { postJournal } from "@/lib/gl";
import { buildAdjustmentNumber } from "@/lib/numbers";
import Decimal from "decimal.js";

const createAdjustmentSchema = z.object({
  reasonType: z.enum(["damage", "loss", "found", "correction"]),
  reason: z.string().trim().min(1).max(255),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        // Signed delta: negative removes stock (damage/loss), positive adds (found/correction).
        quantityDelta: z.number().int().refine((v) => v !== 0, "delta must be non-zero"),
      }),
    )
    .min(1),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 100));

  const rows = await db
    .select()
    .from(stockAdjustments)
    .where(eq(stockAdjustments.branchId, session.user.branchId))
    .orderBy(desc(stockAdjustments.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, adjustments: rows, page, pageSize });
}

// General stock adjustment — posts immediately with reason + audit trail.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createAdjustmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { reasonType, reason, lines } = parsed.data;

  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const branchItems = await db
    .select({
      id: items.id,
      currentStockQuantity: items.currentStockQuantity,
      purchasePrice: items.purchasePrice,
    })
    .from(items)
    .where(and(inArray(items.id, itemIds), eq(items.branchId, session.user.branchId)));
  if (branchItems.length !== itemIds.length) {
    return NextResponse.json({ ok: false, error: "ITEM_NOT_FOUND" }, { status: 404 });
  }
  const priceByItem = new Map(branchItems.map((i) => [i.id, i.purchasePrice]));
  const stockByItem = new Map(branchItems.map((i) => [i.id, i.currentStockQuantity ?? 0]));
  for (const line of lines) {
    if ((stockByItem.get(line.itemId) ?? 0) + line.quantityDelta < 0) {
      return NextResponse.json(
        { ok: false, error: "INSUFFICIENT_STOCK", itemId: line.itemId },
        { status: 409 },
      );
    }
  }

  const [branch] = await db
    .select({ code: branches.code })
    .from(branches)
    .where(eq(branches.id, session.user.branchId))
    .limit(1);

  let adjustmentNumber = "";
  let adjustmentId = "";
  try {
    await db.transaction(async (tx) => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3 && !adjustmentId; attempt++) {
        try {
          const candidate = buildAdjustmentNumber(branch?.code ?? "BR");
          const [adj] = await tx
            .insert(stockAdjustments)
            .values({
              branchId: session.user.branchId,
              adjustmentNumber: candidate,
              reasonType,
              reason,
              createdBy: session.user.id,
            })
            .returning({ id: stockAdjustments.id, adjustmentNumber: stockAdjustments.adjustmentNumber });
          let gainValue = new Decimal(0);
          let lossValue = new Decimal(0);
          for (const line of lines) {
            const before = stockByItem.get(line.itemId) ?? 0;
            await tx.insert(stockAdjustmentDetails).values({
              adjustmentId: adj.id,
              itemId: line.itemId,
              quantityDelta: line.quantityDelta,
              stockBefore: before,
              stockAfter: before + line.quantityDelta,
            });
            await tx
              .update(items)
              .set({ currentStockQuantity: before + line.quantityDelta })
              .where(eq(items.id, line.itemId));
            const value = new Decimal(priceByItem.get(line.itemId) ?? "0").times(
              Math.abs(line.quantityDelta),
            );
            if (line.quantityDelta > 0) gainValue = gainValue.plus(value);
            else lossValue = lossValue.plus(value);
          }
          // GL auto-posting: gains Dr Inventory / Cr Adjustments,
          // losses Dr Adjustments / Cr Inventory.
          if (gainValue.gt(0) || lossValue.gt(0)) {
            await postJournal(
              {
                branchId: session.user.branchId,
                refType: "stock_adjustment",
                refId: adj.id,
                memo: `Stock adjustment ${adj.adjustmentNumber} (${reasonType})`,
                lines: [
                  ...(gainValue.gt(0)
                    ? [
                        { accountCode: "1200", debit: gainValue.toFixed(2) },
                        { accountCode: "5200", credit: gainValue.toFixed(2) },
                      ]
                    : []),
                  ...(lossValue.gt(0)
                    ? [
                        { accountCode: "5200", debit: lossValue.toFixed(2) },
                        { accountCode: "1200", credit: lossValue.toFixed(2) },
                      ]
                    : []),
                ],
                createdBy: session.user.id,
              },
              tx,
            );
          }
          adjustmentId = adj.id;
          adjustmentNumber = adj.adjustmentNumber;
        } catch (err) {
          lastError = err;
        }
      }
      if (!adjustmentId) throw lastError;
    });
  } catch {
    return NextResponse.json({ ok: false, error: "ADJUSTMENT_NUMBER_COLLISION" }, { status: 409 });
  }

  await audit({
    entityType: "StockAdjustment",
    entityId: adjustmentId,
    action: "adjust",
    description: `Stock adjustment ${adjustmentNumber} (${reasonType}): ${reason}`,
    newValues: { adjustmentNumber, reasonType, lines },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json(
    { ok: true, adjustment: { id: adjustmentId, adjustmentNumber } },
    { status: 201 },
  );
}
