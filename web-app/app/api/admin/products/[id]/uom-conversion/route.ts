import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { productUomConversions, products, units } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

const upsertUomSchema = z.object({
  purchaseUnitId: z.string().uuid(),
  saleUnitId: z.string().uuid(),
  conversionFactor: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .refine((v) => Number(v) > 0, "conversionFactor must be > 0"),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (
    !session ||
    (session.user.role !== "admin" && session.user.role !== "inventory")
  ) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { id: productId } = await params;
  const { page, pageSize } = getPaginationParams(new URL(req.url).searchParams);

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(eq(products.id, productId), eq(products.branchId, session.user.branchId), eq(products.isDeleted, false)),
    )
    .limit(1);
  if (!product) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const conversions = await db
    .select()
    .from(productUomConversions)
    .where(
      and(
        eq(productUomConversions.productId, productId),
        eq(productUomConversions.branchId, session.user.branchId),
      ),
    );
  const result = paginateArray(conversions, page, pageSize);
  return NextResponse.json({ ok: true, conversions: result.items, ...result.pagination });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (
    !session ||
    (session.user.role !== "admin" && session.user.role !== "inventory")
  ) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { id: productId } = await params;

  const parsed = upsertUomSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { purchaseUnitId, saleUnitId, conversionFactor } = parsed.data;
  if (purchaseUnitId === saleUnitId) {
    return NextResponse.json(
      { ok: false, error: "PURCHASE_AND_SALE_UNIT_MUST_DIFFER" },
      { status: 400 },
    );
  }

  const [product] = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(
      and(eq(products.id, productId), eq(products.branchId, session.user.branchId), eq(products.isDeleted, false)),
    )
    .limit(1);
  if (!product) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const [purchaseUnit] = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.id, purchaseUnitId), eq(units.branchId, session.user.branchId), eq(units.isDeleted, false)))
    .limit(1);
  const [saleUnit] = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.id, saleUnitId), eq(units.branchId, session.user.branchId), eq(units.isDeleted, false)))
    .limit(1);
  if (!purchaseUnit || !saleUnit) {
    return NextResponse.json({ ok: false, error: "UNIT_NOT_FOUND" }, { status: 404 });
  }

  const [existing] = await db
    .select()
    .from(productUomConversions)
    .where(
      and(
        eq(productUomConversions.productId, productId),
        eq(productUomConversions.branchId, session.user.branchId),
      ),
    )
    .limit(1);

  const conversion = existing
    ? (
        await db
          .update(productUomConversions)
          .set({ purchaseUnitId, saleUnitId, conversionFactor, updatedAt: new Date() })
          .where(eq(productUomConversions.id, existing.id))
          .returning()
      )[0]
    : (
        await db
          .insert(productUomConversions)
          .values({
            branchId: session.user.branchId,
            productId,
            purchaseUnitId,
            saleUnitId,
            conversionFactor,
          })
          .returning()
      )[0];

  await audit({
    entityType: "ProductUomConversion",
    entityId: conversion.id,
    action: existing ? "update" : "create",
    description: `${existing ? "Updated" : "Created"} UOM conversion for product: ${product.name}`,
    newValues: conversion,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, conversion }, { status: existing ? 200 : 201 });
}
