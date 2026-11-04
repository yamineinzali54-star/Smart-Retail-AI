import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, like, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { promotions, promotionProducts, products } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const createPromotionSchema = z.object({
  name: z.string().trim().min(1).max(150),
  type: z.enum(["percentage", "fixed", "bundle", "seasonal"]),
  value: z.string().regex(/^\d+(\.\d{1,2})?$/),
  startDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid date"),
  endDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid date"),
  productIds: z.array(z.string().uuid()).min(1),
  requiredQuantities: z.array(z.number().int().min(1)).optional(),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 100));
  const search = url.searchParams.get("search")?.trim();
  const status = url.searchParams.get("status");
  const type = url.searchParams.get("type");

  const conditions = [eq(promotions.branchId, session.user.branchId)];
  if (search) conditions.push(like(promotions.name, `%${search}%`));
  if (status) conditions.push(sql`${promotions.status}::text = ${status}`);
  if (type) conditions.push(sql`${promotions.type}::text = ${type}`);

  const allPromotions = await db
    .select({
      id: promotions.id,
      name: promotions.name,
      type: promotions.type,
      value: promotions.value,
      startDate: promotions.startDate,
      endDate: promotions.endDate,
      status: promotions.status,
      isAiSuggested: promotions.isAiSuggested,
      createdAt: promotions.createdAt,
      updatedAt: promotions.updatedAt,
    })
    .from(promotions)
    .where(and(...conditions))
    .orderBy(desc(promotions.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, promotions: allPromotions, page, pageSize });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createPromotionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { name, type, value, startDate, endDate, productIds, requiredQuantities } = parsed.data;

  if (new Date(endDate) < new Date(startDate)) {
    return NextResponse.json({ ok: false, error: "END_DATE_BEFORE_START" }, { status: 400 });
  }

  // Validate products exist in branch
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

  // Bundle type requires at least 2 products
  if (type === "bundle" && productIds.length < 2) {
    return NextResponse.json({ ok: false, error: "BUNDLE_REQUIRES_2_PRODUCTS" }, { status: 400 });
  }

  const reqQuantities = requiredQuantities ?? productIds.map(() => 1);
  if (reqQuantities.length !== productIds.length) {
    return NextResponse.json({ ok: false, error: "QUANTITY_ARRAY_MISMATCH" }, { status: 400 });
  }

  const [newPromotion] = await db
    .insert(promotions)
    .values({
      branchId: session.user.branchId,
      name,
      type,
      value,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      status: "draft",
      createdBy: session.user.id,
    })
    .returning();

  // Link products
  await db.insert(promotionProducts).values(
    productIds.map((productId, idx) => ({
      promotionId: newPromotion.id,
      productId,
      requiredQuantity: reqQuantities[idx],
    })),
  );

  await audit({
    entityType: "Promotion",
    entityId: newPromotion.id,
    action: "create",
    description: `Created promotion: ${name} (${type})`,
    newValues: { name, type, value, startDate, endDate, productIds },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, promotion: newPromotion }, { status: 201 });
}