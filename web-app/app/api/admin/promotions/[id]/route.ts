import "server-only";

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { promotions, promotionProducts, products } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const updatePromotionSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  type: z.enum(["percentage", "fixed", "bundle", "seasonal"]).optional(),
  value: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  startDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid date").optional(),
  endDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid date").optional(),
  status: z.enum(["draft", "active", "expired", "deactivated"]).optional(),
  productIds: z.array(z.string().uuid()).optional(),
  requiredQuantities: z.array(z.number().int().min(1)).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;

  const [promotion] = await db
    .select()
    .from(promotions)
    .where(and(eq(promotions.id, id), eq(promotions.branchId, session.user.branchId)))
    .limit(1);

  if (!promotion) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const linkedProducts = await db
    .select({
      productId: promotionProducts.productId,
      productName: products.name,
      requiredQuantity: promotionProducts.requiredQuantity,
    })
    .from(promotionProducts)
    .leftJoin(products, and(eq(promotionProducts.productId, products.id), eq(products.isDeleted, false)))
    .where(eq(promotionProducts.promotionId, id));

  return NextResponse.json({ ok: true, promotion: { ...promotion, products: linkedProducts } });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = updatePromotionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select()
    .from(promotions)
    .where(and(eq(promotions.id, id), eq(promotions.branchId, session.user.branchId)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const data = parsed.data;

  if (data.startDate && data.endDate && new Date(data.endDate) < new Date(data.startDate)) {
    return NextResponse.json({ ok: false, error: "END_DATE_BEFORE_START" }, { status: 400 });
  }

  // If productIds provided, validate them
  if (data.productIds) {
    const foundProducts = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          inArray(products.id, data.productIds),
          eq(products.branchId, session.user.branchId),
          eq(products.isDeleted, false),
        ),
      );
    if (foundProducts.length !== data.productIds.length) {
      return NextResponse.json({ ok: false, error: "PRODUCT_NOT_FOUND" }, { status: 404 });
    }

    if (data.type === "bundle" && data.productIds.length < 2) {
      return NextResponse.json({ ok: false, error: "BUNDLE_REQUIRES_2_PRODUCTS" }, { status: 400 });
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.type !== undefined) updateData.type = data.type;
  if (data.value !== undefined) updateData.value = data.value;
  if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
  if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate);
  if (data.status !== undefined) updateData.status = data.status;

  const [updated] = await db
    .update(promotions)
    .set(updateData)
    .where(eq(promotions.id, id))
    .returning();

  // Update product links if provided
  if (data.productIds !== undefined) {
    await db.delete(promotionProducts).where(eq(promotionProducts.promotionId, id));
    const reqQuantities = data.requiredQuantities ?? data.productIds.map(() => 1);
    await db.insert(promotionProducts).values(
      data.productIds.map((productId, idx) => ({
        promotionId: id,
        productId,
        requiredQuantity: reqQuantities[idx],
      })),
    );
  }

  await audit({
    entityType: "Promotion",
    entityId: id,
    action: "update",
    description: `Updated promotion: ${updated.name}`,
    oldValues: existing,
    newValues: updated,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, promotion: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;

  const [deleted] = await db
    .delete(promotions)
    .where(and(eq(promotions.id, id), eq(promotions.branchId, session.user.branchId)))
    .returning();

  if (!deleted) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  // Also delete product links
  await db.delete(promotionProducts).where(eq(promotionProducts.promotionId, id));

  await audit({
    entityType: "Promotion",
    entityId: id,
    action: "delete",
    description: `Deleted promotion: ${deleted.name}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true });
}
