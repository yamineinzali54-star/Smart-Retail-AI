import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { products, categories, units } from "@/db/schema";
import { getSession, getClientIp } from "@/lib/auth";
import { audit } from "@/lib/audit";

const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  categoryId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  reorderThreshold: z.number().int().min(0).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const [product] = await db
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
    .where(and(eq(products.id, id), eq(products.isDeleted, false)))
    .limit(1);

  if (!product) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, product });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = updateProductSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.isDeleted, false)))
    .limit(1);

  if (!product) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const [updated] = await db
    .update(products)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.isDeleted, false)))
    .returning();

  await audit({
    entityType: "Product",
    entityId: id,
    action: "update",
    description: `Updated product: ${product.name}`,
    oldValues: { name: product.name, categoryId: product.categoryId, unitId: product.unitId, reorderThreshold: product.reorderThreshold },
    newValues: parsed.data,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, product: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.isDeleted, false)))
    .limit(1);

  if (!product) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const [updated] = await db
    .update(products)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.isDeleted, false)))
    .returning();

  await audit({
    entityType: "Product",
    entityId: id,
    action: "soft_delete",
    description: `Soft-deleted product: ${product.name}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, product: updated });
}
