import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { z } from "zod";
import Decimal from "decimal.js";

import { db } from "@/db";
import {
  branches,
  poDetails,
  products,
  purchaseOrders,
  suppliers,
} from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildPurchaseOrderNumber } from "@/lib/numbers";

const createPOSchema = z.object({
  supplierId: z.string().uuid(),
  expectedDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid date"),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
        unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
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
  const supplierId = url.searchParams.get("supplierId");
  const status = url.searchParams.get("status");
  const paymentStatus = url.searchParams.get("paymentStatus");
  const search = url.searchParams.get("search")?.trim();
  const productId = url.searchParams.get("productId");

  const conditions = [eq(purchaseOrders.branchId, session.user.branchId)];
  if (supplierId) conditions.push(eq(purchaseOrders.supplierId, supplierId));
  if (status === "pending" || status === "partially_received" || status === "received") {
    conditions.push(eq(purchaseOrders.status, status));
  }
  if (paymentStatus === "unpaid" || paymentStatus === "partial" || paymentStatus === "paid") {
    conditions.push(eq(purchaseOrders.paymentStatus, paymentStatus));
  }
  if (search) conditions.push(ilike(purchaseOrders.poNumber, `%${search}%`));
  if (productId) {
    const matching = await db
      .select({ poId: poDetails.poId })
      .from(poDetails)
      .where(eq(poDetails.productId, productId));
    const ids = [...new Set(matching.map((m) => m.poId))];
    if (ids.length === 0) {
      return NextResponse.json({ ok: true, purchaseOrders: [], page, pageSize });
    }
    conditions.push(inArray(purchaseOrders.id, ids));
  }

  const allPOs = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.name,
      orderDate: purchaseOrders.orderDate,
      expectedDate: purchaseOrders.expectedDate,
      status: purchaseOrders.status,
      approvalStatus: purchaseOrders.approvalStatus,
      paymentStatus: purchaseOrders.paymentStatus,
      totalAmount: purchaseOrders.totalAmount,
      createdBy: purchaseOrders.createdBy,
      createdAt: purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .leftJoin(
      suppliers,
      and(eq(purchaseOrders.supplierId, suppliers.id), eq(suppliers.isDeleted, false)),
    )
    .where(and(...conditions))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, purchaseOrders: allPOs, page, pageSize });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createPOSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { supplierId, expectedDate, items } = parsed.data;

  const [supplier] = await db
    .select({ id: suppliers.id, name: suppliers.name })
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

  const productIds = [...new Set(items.map((i) => i.productId))];
  const foundProducts = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        inArray(products.id, productIds),
        eq(products.branchId, session.user.branchId),
        eq(products.isDeleted, false),
      ),
    );
  if (foundProducts.length !== productIds.length) {
    return NextResponse.json({ ok: false, error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }

  const totalAmount = items
    .reduce(
      (sum, item) => sum.plus(new Decimal(item.unitPrice).times(item.quantity)),
      new Decimal(0),
    )
    .toFixed(2);

  const [branch] = await db
    .select({ code: branches.code, poApprovalThreshold: branches.poApprovalThreshold })
    .from(branches)
    .where(eq(branches.id, session.user.branchId))
    .limit(1);
  const branchCode = branch?.code ?? "BR";
  // Batch 2 #12 — POs at/above the branch threshold need approval before GRN;
  // smaller ones auto-approve on creation.
  const needsApproval =
    branch?.poApprovalThreshold != null &&
    new Decimal(totalAmount).greaterThanOrEqualTo(branch.poApprovalThreshold);

  let newPO: { id: string; poNumber: string };
  try {
    newPO = await db.transaction(async (tx) => {
      // Retry on po_number collision (branch/date components embedded, §5)
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const poNumber = buildPurchaseOrderNumber(branchCode);
        try {
          const [po] = await tx
            .insert(purchaseOrders)
            .values({
              branchId: session.user.branchId,
              poNumber,
              supplierId,
              expectedDate: new Date(expectedDate),
              status: "pending",
              approvalStatus: needsApproval ? "pending" : "approved",
              approvedBy: needsApproval ? null : session.user.id,
              paymentStatus: "unpaid",
              totalAmount,
              createdBy: session.user.id,
            })
            .returning({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber });
          await tx.insert(poDetails).values(
            items.map((item) => ({
              poId: po.id,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
            })),
          );
          return po;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError;
    });
  } catch {
    return NextResponse.json({ ok: false, error: "PO_NUMBER_COLLISION" }, { status: 409 });
  }

  await audit({
    entityType: "PurchaseOrder",
    entityId: newPO.id,
    action: "create",
    description: `Created PO: ${newPO.poNumber}`,
    newValues: { poNumber: newPO.poNumber, supplierId, totalAmount, itemCount: items.length },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json(
    { ok: true, purchaseOrder: { ...newPO, totalAmount } },
    { status: 201 },
  );
}
