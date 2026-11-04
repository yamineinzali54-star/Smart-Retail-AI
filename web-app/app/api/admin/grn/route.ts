import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { z } from "zod";
import Decimal from "decimal.js";

import { db } from "@/db";
import {
  branches,
  categories,
  grns,
  items,
  poDetails,
  productUomConversions,
  products,
  purchaseOrders,
  suppliers,
} from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildGrnNumber } from "@/lib/numbers";

const createGRNSchema = z.object({
  poId: z.string().uuid(),
  remarks: z.string().max(255).optional(),
  lines: z.array(
    z.object({
      productId: z.string().uuid(),
      receivedQty: z.number().int().min(0),
      expiryDate: z
        .string()
        .refine((v) => !Number.isNaN(Date.parse(v)), "invalid date")
        .optional(),
      sellingPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
      remarks: z.string().max(255).optional(),
    }),
  ),
});

function shortSegment(uuid: string): string {
  return uuid.replace(/-/g, "").slice(-4).toUpperCase();
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 100));
  const poNumber = url.searchParams.get("poNumber")?.trim();

  const conditions = [eq(grns.branchId, session.user.branchId)];
  if (poNumber) conditions.push(ilike(purchaseOrders.poNumber, `%${poNumber}%`));

  const allGRNs = await db
    .select({
      id: grns.id,
      grnNumber: grns.grnNumber,
      poId: grns.poId,
      poNumber: purchaseOrders.poNumber,
      supplierName: suppliers.name,
      receivedDate: grns.receivedDate,
      createdBy: grns.createdBy,
      createdAt: grns.createdAt,
    })
    .from(grns)
    .leftJoin(purchaseOrders, eq(grns.poId, purchaseOrders.id))
    .leftJoin(
      suppliers,
      and(eq(purchaseOrders.supplierId, suppliers.id), eq(suppliers.isDeleted, false)),
    )
    .where(and(...conditions))
    .orderBy(desc(grns.receivedDate))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, grns: allGRNs, page, pageSize });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createGRNSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { poId, remarks, lines } = parsed.data;
  const receivable = lines.filter((l) => l.receivedQty > 0);
  if (receivable.length === 0) {
    return NextResponse.json({ ok: false, error: "NOTHING_TO_RECEIVE" }, { status: 400 });
  }

  const [po] = await db
    .select()
    .from(purchaseOrders)
    .where(
      and(eq(purchaseOrders.id, poId), eq(purchaseOrders.branchId, session.user.branchId)),
    )
    .limit(1);
  if (!po) {
    return NextResponse.json({ ok: false, error: "PO_NOT_FOUND" }, { status: 404 });
  }
  // Batch 2 #12 — no receiving against unapproved or rejected POs.
  if (po.approvalStatus !== "approved") {
    return NextResponse.json({ ok: false, error: "PO_NOT_APPROVED" }, { status: 409 });
  }

  // PO line unit prices (purchase unit) — Items.purchase_price copies the line,
  // never the PO total.
  const poLines = await db.select().from(poDetails).where(eq(poDetails.poId, poId));
  const unitPriceByProduct = new Map(poLines.map((l) => [l.productId, l.unitPrice]));
  for (const line of receivable) {
    if (!unitPriceByProduct.has(line.productId)) {
      return NextResponse.json(
        { ok: false, error: "PRODUCT_NOT_IN_PO", productId: line.productId },
        { status: 400 },
      );
    }
  }

  const productIds = [...new Set(receivable.map((l) => l.productId))];
  const branchProducts = await db
    .select({ id: products.id, categoryId: products.categoryId })
    .from(products)
    .where(
      and(
        inArray(products.id, productIds),
        eq(products.branchId, session.user.branchId),
        eq(products.isDeleted, false),
      ),
    );
  if (branchProducts.length !== productIds.length) {
    return NextResponse.json({ ok: false, error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }
  const categoryByProduct = new Map(branchProducts.map((p) => [p.id, p.categoryId]));
  const categoryIds = [...new Set(branchProducts.map((p) => p.categoryId))];
  const branchCategories = await db
    .select({ id: categories.id, shortName: categories.shortName })
    .from(categories)
    .where(and(inArray(categories.id, categoryIds), eq(categories.isDeleted, false)));
  const shortByCategory = new Map(branchCategories.map((c) => [c.id, c.shortName]));

  // §4 R5 — UOM conversion happens at exactly one place: GRN confirm.
  const conversions = await db
    .select()
    .from(productUomConversions)
    .where(
      and(
        inArray(productUomConversions.productId, productIds),
        eq(productUomConversions.branchId, session.user.branchId),
      ),
    );
  const factorByProduct = new Map(
    conversions.map((c) => [c.productId, Number(c.conversionFactor)]),
  );

  const [branch] = await db
    .select({ code: branches.code })
    .from(branches)
    .where(eq(branches.id, session.user.branchId))
    .limit(1);
  const branchCode = branch?.code ?? "BR";
  const year = new Date().getFullYear();
  const supplierSeg = shortSegment(po.supplierId);

  let newGRN: { id: string; grnNumber: string };
  try {
    newGRN = await db.transaction(async (tx) => {
      let grn: { id: string; grnNumber: string } | undefined;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3 && !grn; attempt++) {
        try {
          const [row] = await tx
            .insert(grns)
            .values({
              branchId: session.user.branchId,
              grnNumber: buildGrnNumber(branchCode),
              poId,
              remarks: remarks ?? null,
              createdBy: session.user.id,
            })
            .returning({ id: grns.id, grnNumber: grns.grnNumber });
          grn = row;
        } catch (err) {
          lastError = err;
        }
      }
      if (!grn) throw lastError;

      for (const line of receivable) {
        const factor = factorByProduct.get(line.productId) ?? 1;
        const saleQty = Math.round(line.receivedQty * factor);
        const catShort = shortByCategory.get(categoryByProduct.get(line.productId)!) ?? "X";
        const base =
          `${catShort}-${year}-${supplierSeg}-${shortSegment(line.productId)}-`;
        // Barcode embeds the GRN segment (§4 R1); on the rare collision
        // (same product twice in one GRN) fall back to a random segment.
        let barcode = `${base}${shortSegment(grn.id)}`;
        try {
          await tx.insert(items).values({
            id: randomUUID(),
            branchId: session.user.branchId,
            productId: line.productId,
            grnId: grn.id,
            poId,
            barcode,
            receivedQuantity: saleQty,
            currentStockQuantity: saleQty,
            purchasePrice: unitPriceByProduct.get(line.productId)!,
            sellingPrice: line.sellingPrice,
            expiryDate: line.expiryDate ? new Date(line.expiryDate) : null,
            remarks: line.remarks ?? null,
          });
        } catch {
          barcode = `${base}${shortSegment(randomUUID())}`;
          await tx.insert(items).values({
            id: randomUUID(),
            branchId: session.user.branchId,
            productId: line.productId,
            grnId: grn.id,
            poId,
            barcode,
            receivedQuantity: saleQty,
            currentStockQuantity: saleQty,
            purchasePrice: unitPriceByProduct.get(line.productId)!,
            sellingPrice: line.sellingPrice,
            expiryDate: line.expiryDate ? new Date(line.expiryDate) : null,
            remarks: line.remarks ?? null,
          });
        }
      }

      // §4 R3 — recompute PO status from cumulative received quantities.
      const allItems = await tx
        .select({ productId: items.productId, receivedQuantity: items.receivedQuantity })
        .from(items)
        .where(eq(items.poId, poId));
      const receivedByProduct = new Map<string, number>();
      for (const row of allItems) {
        receivedByProduct.set(
          row.productId,
          (receivedByProduct.get(row.productId) ?? 0) + row.receivedQuantity,
        );
      }
      const allFulfilled = poLines.every(
        (l) => (receivedByProduct.get(l.productId) ?? 0) >= l.quantity,
      );
      const anyReceived = poLines.some((l) => (receivedByProduct.get(l.productId) ?? 0) > 0);
      await tx
        .update(purchaseOrders)
        .set({ status: allFulfilled ? "received" : anyReceived ? "partially_received" : "pending" })
        .where(eq(purchaseOrders.id, poId));

      // GL auto-posting: Dr Inventory / Cr Accounts Payable at cost.
      const { postJournal } = await import("@/lib/gl");
      let grnValue = new Decimal("0");
      for (const line of receivable) {
        const factor = factorByProduct.get(line.productId) ?? 1;
        grnValue = grnValue.plus(
          new Decimal(unitPriceByProduct.get(line.productId)!).times(
            Math.round(line.receivedQty * factor),
          ),
        );
      }
      if (grnValue.gt(0)) {
        await postJournal(
          {
            branchId: session.user.branchId,
            refType: "grn",
            refId: grn.id,
            memo: `GRN ${grn.grnNumber} received`,
            lines: [
              { accountCode: "1200", debit: grnValue.toFixed(2) },
              { accountCode: "2000", credit: grnValue.toFixed(2) },
            ],
            createdBy: session.user.id,
          },
          tx,
        );
      }

      return grn;
    });
  } catch {
    return NextResponse.json({ ok: false, error: "GRN_FAILED" }, { status: 409 });
  }

  await audit({
    entityType: "GRN",
    entityId: newGRN.id,
    action: "create",
    description: `Created GRN: ${newGRN.grnNumber}`,
    newValues: { grnNumber: newGRN.grnNumber, poId, lineCount: receivable.length },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, grn: newGRN }, { status: 201 });
}
