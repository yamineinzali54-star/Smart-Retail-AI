import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { db } from "@/db";
import {
  branches,
  categories,
  items,
  products,
  stockTransferDetails,
  stockTransfers,
} from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";

const fromBranches = alias(branches, "from_branch");
const toBranches = alias(branches, "to_branch");

const updateStatusSchema = z.object({
  status: z.enum(["approved", "in_transit", "received"]),
});

function seg(uuid: string): string {
  return uuid.replace(/-/g, "").slice(-4).toUpperCase();
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;

  const [transfer] = await db
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
    .where(eq(stockTransfers.id, id))
    .limit(1);

  if (
    !transfer ||
    (transfer.fromBranchId !== session.user.branchId &&
      transfer.toBranchId !== session.user.branchId)
  ) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const details = await db
    .select({
      id: stockTransferDetails.id,
      itemId: stockTransferDetails.itemId,
      productName: products.name,
      barcode: items.barcode,
      quantity: stockTransferDetails.quantity,
    })
    .from(stockTransferDetails)
    .leftJoin(items, eq(stockTransferDetails.itemId, items.id))
    .leftJoin(products, and(eq(items.productId, products.id), eq(products.isDeleted, false)))
    .where(eq(stockTransferDetails.transferId, id));

  return NextResponse.json({ ok: true, transfer: { ...transfer, details } });
}

// §6.6 — status flow: pending → approved → in_transit → received.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = updateStatusSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { status } = parsed.data;

  const [transfer] = await db
    .select()
    .from(stockTransfers)
    .where(eq(stockTransfers.id, id))
    .limit(1);
  if (!transfer) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const details = await db
    .select()
    .from(stockTransferDetails)
    .where(eq(stockTransferDetails.transferId, id));

  if (status === "approved") {
    if (transfer.status !== "pending") {
      return NextResponse.json({ ok: false, error: "INVALID_TRANSITION" }, { status: 400 });
    }
    if (!(await hasPermission(session.user.role, "transfer.approve"))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }
    const [updated] = await db
      .update(stockTransfers)
      .set({ status, approvedBy: session.user.id })
      .where(eq(stockTransfers.id, id))
      .returning();
    await audit({
      entityType: "StockTransfer",
      entityId: id,
      action: "approve",
      description: `Approved transfer: ${transfer.transferNumber}`,
      userId: session.user.id,
      branchId: session.user.branchId,
      ipAddress: await getClientIp(),
    });
    return NextResponse.json({ ok: true, transfer: updated });
  }

  if (status === "in_transit") {
    if (transfer.status !== "approved") {
      return NextResponse.json({ ok: false, error: "INVALID_TRANSITION" }, { status: 400 });
    }
    try {
      await db.transaction(async (tx) => {
        for (const line of details) {
          const [item] = await tx
            .select({ currentStockQuantity: items.currentStockQuantity })
            .from(items)
            .where(
              and(eq(items.id, line.itemId), eq(items.branchId, transfer.fromBranchId)),
            )
            .limit(1);
          if (!item || (item.currentStockQuantity ?? 0) < line.quantity) {
            throw new Error("INSUFFICIENT_STOCK");
          }
          await tx
            .update(items)
            .set({ currentStockQuantity: (item.currentStockQuantity ?? 0) - line.quantity })
            .where(eq(items.id, line.itemId));
        }
        await tx
          .update(stockTransfers)
          .set({ status })
          .where(eq(stockTransfers.id, id));
      });
    } catch (err) {
      if (err instanceof Error && err.message === "INSUFFICIENT_STOCK") {
        return NextResponse.json({ ok: false, error: "INSUFFICIENT_STOCK" }, { status: 409 });
      }
      throw err;
    }
    await audit({
      entityType: "StockTransfer",
      entityId: id,
      action: "update",
      description: `Transfer in transit: ${transfer.transferNumber}`,
      userId: session.user.id,
      branchId: session.user.branchId,
      ipAddress: await getClientIp(),
    });
    return NextResponse.json({ ok: true });
  }

  // status === "received" — destination creates branch-scoped batch rows.
  if (transfer.status !== "in_transit") {
    return NextResponse.json({ ok: false, error: "INVALID_TRANSITION" }, { status: 400 });
  }
  const itemIds = details.map((d) => d.itemId);
  const sourceItems =
    itemIds.length === 0
      ? []
      : await db
          .select()
          .from(items)
          .where(inArray(items.id, itemIds));
  const productIds = [...new Set(sourceItems.map((i) => i.productId))];
  const prods =
    productIds.length === 0
      ? []
      : await db
          .select({ id: products.id, categoryId: products.categoryId })
          .from(products)
          .where(and(inArray(products.id, productIds), eq(products.isDeleted, false)));
  const catIds = [...new Set(prods.map((p) => p.categoryId))];
  const cats =
    catIds.length === 0
      ? []
      : await db
          .select({ id: categories.id, shortName: categories.shortName })
          .from(categories)
          .where(and(inArray(categories.id, catIds), eq(categories.isDeleted, false)));
  const shortByCategory = new Map(cats.map((c) => [c.id, c.shortName]));
  const catByProduct = new Map(prods.map((p) => [p.id, p.categoryId]));
  const itemById = new Map(sourceItems.map((i) => [i.id, i]));
  const year = new Date().getFullYear();

  const received = await db.transaction(async (tx) => {
    for (const line of details) {
      const src = itemById.get(line.itemId);
      if (!src) throw new Error("ITEM_NOT_FOUND" as const);
      const catShort = shortByCategory.get(catByProduct.get(src.productId)!) ?? "X";
      const barcode = `${catShort}-${year}-${seg(src.productId)}-${seg(transfer.toBranchId)}-${seg(randomUUID())}`;
      await tx.insert(items).values({
        id: randomUUID(),
        branchId: transfer.toBranchId,
        productId: src.productId,
        grnId: src.grnId,
        poId: src.poId,
        barcode,
        receivedQuantity: line.quantity,
        currentStockQuantity: line.quantity,
        purchasePrice: src.purchasePrice,
        sellingPrice: src.sellingPrice,
        expiryDate: src.expiryDate,
        remarks: `Transfer ${transfer.transferNumber}`,
      });
    }
    await tx
      .update(stockTransfers)
      .set({ status })
      .where(eq(stockTransfers.id, id));
    return true;
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message === "ITEM_NOT_FOUND") return false;
    throw err;
  });
  if (!received) {
    return NextResponse.json({ ok: false, error: "ITEM_NOT_FOUND" }, { status: 404 });
  }

  await audit({
    entityType: "StockTransfer",
    entityId: id,
    action: "receive",
    description: `Received transfer: ${transfer.transferNumber}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });
  return NextResponse.json({ ok: true });
}
