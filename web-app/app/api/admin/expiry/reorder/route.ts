import "server-only";

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import Decimal from "decimal.js";

import { db } from "@/db";
import { branches, poDetails, products, purchaseOrders, suppliers } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildReorderNumber } from "@/lib/numbers";

const reorderSchema = z.object({
  supplierId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
        unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
      }),
    )
    .min(1),
});

// §6.5 — Reorder: prefill a new PO (supplier, items, qty, price) → Pending.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = reorderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { supplierId, lines } = parsed.data;

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

  const productIds = [...new Set(lines.map((l) => l.productId))];
  const found = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        inArray(products.id, productIds),
        eq(products.branchId, session.user.branchId),
        eq(products.isDeleted, false),
      ),
    );
  if (found.length !== productIds.length) {
    return NextResponse.json({ ok: false, error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }

  const totalAmount = lines
    .reduce(
      (sum, l) => sum.plus(new Decimal(l.unitPrice).times(l.quantity)),
      new Decimal(0),
    )
    .toFixed(2);

  const [branch] = await db
    .select({ code: branches.code })
    .from(branches)
    .where(eq(branches.id, session.user.branchId))
    .limit(1);

  const expectedDate = new Date(Date.now() + 7 * 86_400_000);
  let poNumber = "";
  let poId = "";
  try {
    await db.transaction(async (tx) => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3 && !poId; attempt++) {
        try {
          const candidate = buildReorderNumber(branch?.code ?? "BR");
          const [po] = await tx
            .insert(purchaseOrders)
            .values({
              branchId: session.user.branchId,
              poNumber: candidate,
              supplierId,
              expectedDate,
              status: "pending",
              paymentStatus: "unpaid",
              totalAmount,
              createdBy: session.user.id,
            })
            .returning({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber });
          await tx.insert(poDetails).values(
            lines.map((l) => ({
              poId: po.id,
              productId: l.productId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
            })),
          );
          poId = po.id;
          poNumber = po.poNumber;
        } catch (err) {
          lastError = err;
        }
      }
      if (!poId) throw lastError;
    });
  } catch {
    return NextResponse.json({ ok: false, error: "PO_NUMBER_COLLISION" }, { status: 409 });
  }

  await audit({
    entityType: "PurchaseOrder",
    entityId: poId,
    action: "reorder",
    description: `Created reorder PO: ${poNumber}`,
    newValues: { poNumber, supplierId, totalAmount },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, purchaseOrder: { id: poId, poNumber } }, { status: 201 });
}
