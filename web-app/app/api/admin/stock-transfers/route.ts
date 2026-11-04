import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { db } from "@/db";
import { branches, items, stockTransferDetails, stockTransfers } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildTransferNumber } from "@/lib/numbers";

const fromBranches = alias(branches, "from_branch");
const toBranches = alias(branches, "to_branch");

const createTransferSchema = z.object({
  fromBranchId: z.string().uuid(),
  toBranchId: z.string().uuid(),
  items: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantity: z.number().int().min(1),
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

  const allTransfers = await db
    .select({
      id: stockTransfers.id,
      transferNumber: stockTransfers.transferNumber,
      fromBranchId: stockTransfers.fromBranchId,
      fromBranchName: fromBranches.name,
      toBranchId: stockTransfers.toBranchId,
      toBranchName: toBranches.name,
      status: stockTransfers.status,
      createdBy: stockTransfers.createdBy,
      createdAt: stockTransfers.createdAt,
    })
    .from(stockTransfers)
    .leftJoin(fromBranches, eq(stockTransfers.fromBranchId, fromBranches.id))
    .leftJoin(toBranches, eq(stockTransfers.toBranchId, toBranches.id))
    .where(
      or(
        eq(stockTransfers.fromBranchId, session.user.branchId),
        eq(stockTransfers.toBranchId, session.user.branchId),
      ),
    )
    .orderBy(desc(stockTransfers.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, transfers: allTransfers, page, pageSize });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createTransferSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { fromBranchId, toBranchId, items: transferItems } = parsed.data;

  if (fromBranchId === toBranchId) {
    return NextResponse.json({ ok: false, error: "SAME_BRANCH" }, { status: 400 });
  }

  const branchRows = await db
    .select({ id: branches.id, code: branches.code })
    .from(branches)
    .where(inArray(branches.id, [fromBranchId, toBranchId]));
  const codeById = new Map(branchRows.map((b) => [b.id, b.code]));
  if (!codeById.has(fromBranchId) || !codeById.has(toBranchId)) {
    return NextResponse.json({ ok: false, error: "BRANCH_NOT_FOUND" }, { status: 404 });
  }

  // Source session branch owns the stock — items must live at fromBranch.
  const itemIds = [...new Set(transferItems.map((i) => i.itemId))];
  const sourceItems = await db
    .select({
      id: items.id,
      currentStockQuantity: items.currentStockQuantity,
    })
    .from(items)
    .where(and(inArray(items.id, itemIds), eq(items.branchId, fromBranchId)));
  if (sourceItems.length !== itemIds.length) {
    return NextResponse.json({ ok: false, error: "ITEM_NOT_FOUND" }, { status: 404 });
  }
  const stockByItem = new Map(sourceItems.map((i) => [i.id, i.currentStockQuantity ?? 0]));
  for (const line of transferItems) {
    if (line.quantity > (stockByItem.get(line.itemId) ?? 0)) {
      return NextResponse.json(
        { ok: false, error: "INSUFFICIENT_STOCK", itemId: line.itemId },
        { status: 409 },
      );
    }
  }

  let transferNumber = "";
  let transferId = "";
  try {
    await db.transaction(async (tx) => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3 && !transferId; attempt++) {
        try {
          const candidate = buildTransferNumber(
            codeById.get(fromBranchId)!,
            codeById.get(toBranchId)!,
          );
          const [t] = await tx
            .insert(stockTransfers)
            .values({
              transferNumber: candidate,
              fromBranchId,
              toBranchId,
              status: "pending",
              createdBy: session.user.id,
            })
            .returning({ id: stockTransfers.id, transferNumber: stockTransfers.transferNumber });
          await tx.insert(stockTransferDetails).values(
            transferItems.map((item) => ({
              transferId: t.id,
              itemId: item.itemId,
              quantity: item.quantity,
            })),
          );
          transferId = t.id;
          transferNumber = t.transferNumber;
        } catch (err) {
          lastError = err;
        }
      }
      if (!transferId) throw lastError;
    });
  } catch {
    return NextResponse.json({ ok: false, error: "TRANSFER_NUMBER_COLLISION" }, { status: 409 });
  }

  await audit({
    entityType: "StockTransfer",
    entityId: transferId,
    action: "create",
    description: `Created transfer: ${transferNumber}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json(
    { ok: true, transfer: { id: transferId, transferNumber } },
    { status: 201 },
  );
}
