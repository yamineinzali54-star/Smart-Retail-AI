import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import Decimal from "decimal.js";

import { db } from "@/db";
import {
  branches,
  grns,
  items,
  supplierReturnDetails,
  supplierReturns,
  suppliers,
} from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildDebitNoteNumber } from "@/lib/numbers";

const createReturnSchema = z.object({
  supplierId: z.string().uuid(),
  grnId: z.string().uuid().optional(),
  reason: z.string().min(1).max(255),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantity: z.number().int().min(1),
        unitCost: z.string().regex(/^\d+(\.\d{1,2})?$/),
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

  const allReturns = await db
    .select({
      id: supplierReturns.id,
      debitNoteNumber: supplierReturns.debitNoteNumber,
      supplierId: supplierReturns.supplierId,
      supplierName: suppliers.name,
      grnId: supplierReturns.grnId,
      returnDate: supplierReturns.returnDate,
      reason: supplierReturns.reason,
      status: supplierReturns.status,
      createdBy: supplierReturns.createdBy,
      createdAt: supplierReturns.createdAt,
    })
    .from(supplierReturns)
    .leftJoin(suppliers, and(eq(supplierReturns.supplierId, suppliers.id), eq(suppliers.isDeleted, false)))
    .where(eq(supplierReturns.branchId, session.user.branchId))
    .orderBy(desc(supplierReturns.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, returns: allReturns, page, pageSize });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createReturnSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { supplierId, grnId, reason, lines } = parsed.data;

  const [supplier] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, supplierId),
        eq(suppliers.branchId, session.user.branchId),
        eq(suppliers.isDeleted, false),
      ),
    )
    .limit(1);
  if (!supplier) {
    return NextResponse.json({ ok: false, error: "SUPPLIER_NOT_FOUND" }, { status: 404 });
  }

  if (grnId) {
    const [grn] = await db
      .select({ id: grns.id })
      .from(grns)
      .where(and(eq(grns.id, grnId), eq(grns.branchId, session.user.branchId)))
      .limit(1);
    if (!grn) {
      return NextResponse.json({ ok: false, error: "GRN_NOT_FOUND" }, { status: 404 });
    }
  }

  // §9 — return qty must not exceed the batch's live stock.
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const branchItems = await db
    .select({ id: items.id, currentStockQuantity: items.currentStockQuantity })
    .from(items)
    .where(and(inArray(items.id, itemIds), eq(items.branchId, session.user.branchId)));
  if (branchItems.length !== itemIds.length) {
    return NextResponse.json({ ok: false, error: "ITEM_NOT_FOUND" }, { status: 404 });
  }
  const stockByItem = new Map(branchItems.map((i) => [i.id, i.currentStockQuantity ?? 0]));
  for (const line of lines) {
    if (line.quantity > (stockByItem.get(line.itemId) ?? 0)) {
      return NextResponse.json(
        { ok: false, error: "RETURN_QTY_EXCEEDS_STOCK", itemId: line.itemId },
        { status: 409 },
      );
    }
  }

  const [branch] = await db
    .select({ code: branches.code })
    .from(branches)
    .where(eq(branches.id, session.user.branchId))
    .limit(1);

  let debitNoteNumber = "";
  let returnId = "";
  try {
    await db.transaction(async (tx) => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3 && !returnId; attempt++) {
        try {
          const candidate = buildDebitNoteNumber(branch?.code ?? "BR");
          const [row] = await tx
            .insert(supplierReturns)
            .values({
              branchId: session.user.branchId,
              debitNoteNumber: candidate,
              supplierId,
              grnId: grnId ?? null,
              returnDate: new Date(),
              reason,
              status: "draft",
              createdBy: session.user.id,
            })
            .returning({ id: supplierReturns.id, debitNoteNumber: supplierReturns.debitNoteNumber });
          await tx.insert(supplierReturnDetails).values(
            lines.map((line) => ({
              returnId: row.id,
              itemId: line.itemId,
              quantity: line.quantity,
              unitCost: line.unitCost,
              totalValue: new Decimal(line.unitCost).times(line.quantity).toFixed(2),
            })),
          );
          returnId = row.id;
          debitNoteNumber = row.debitNoteNumber;
        } catch (err) {
          lastError = err;
        }
      }
      if (!returnId) throw lastError;
    });
  } catch {
    return NextResponse.json({ ok: false, error: "DEBIT_NOTE_COLLISION" }, { status: 409 });
  }

  await audit({
    entityType: "SupplierReturn",
    entityId: returnId,
    action: "create",
    description: `Created supplier return: ${debitNoteNumber}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json(
    { ok: true, return: { id: returnId, debitNoteNumber } },
    { status: 201 },
  );
}
