import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { products, categories, units } from "@/db/schema";
import { getSession, getClientIp } from "@/lib/auth";
import { audit } from "@/lib/audit";

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(150),
  categoryId: z.string().uuid(),
  unitId: z.string().uuid(),
  reorderThreshold: z.number().int().min(0).default(5),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 100));

  const allProducts = await db
    .select({
      id: products.id,
      name: products.name,
      categoryId: products.categoryId,
      categoryName: categories.name,
      unitId: products.unitId,
      unitName: units.name,
      reorderThreshold: products.reorderThreshold,
      isDeleted: products.isDeleted,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .leftJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.isDeleted, false)))
    .leftJoin(units, and(eq(products.unitId, units.id), eq(units.isDeleted, false)))
    .where(
      and(eq(products.branchId, session.user.branchId), eq(products.isDeleted, false)),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, products: allProducts, page, pageSize });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createProductSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { name, categoryId, unitId, reorderThreshold } = parsed.data;

  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.isDeleted, false)))
    .limit(1);

  if (!category) {
    return NextResponse.json({ ok: false, error: "CATEGORY_NOT_FOUND" }, { status: 404 });
  }

  const [unit] = await db
    .select()
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.isDeleted, false)))
    .limit(1);

  if (!unit) {
    return NextResponse.json({ ok: false, error: "UNIT_NOT_FOUND" }, { status: 404 });
  }

  const [newProduct] = await db
    .insert(products)
    .values({
      branchId: session.user.branchId,
      name,
      categoryId,
      unitId,
      reorderThreshold,
    })
    .returning();

  await audit({
    entityType: "Product",
    entityId: newProduct.id,
    action: "create",
    description: `Created product: ${name}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, product: newProduct }, { status: 201 });
}
