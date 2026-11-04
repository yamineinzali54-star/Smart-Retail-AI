import "server-only";

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { suppliers, supplierProducts, products } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const updateSupplierSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  contactPerson: z.string().trim().max(100).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().email().max(150).optional().nullable(),
  address: z.string().trim().max(255).optional().nullable(),
  productIds: z.array(z.string().uuid()).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, id), eq(suppliers.isDeleted, false)))
    .limit(1);

  if (!supplier) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const supplierProductLinks = await db
    .select()
    .from(supplierProducts)
    .where(eq(supplierProducts.supplierId, id));

  const supplierProductsList = await db
    .select()
    .from(products)
    .where(and(eq(products.branchId, session.user.branchId), eq(products.isDeleted, false)));

  const productIds = supplierProductLinks.map((sp) => sp.productId);
  const productsList = supplierProductsList
    .filter((p) => productIds.includes(p.id))
    .map((p) => ({ id: p.id, name: p.name }));

  return NextResponse.json({
    ok: true,
    supplier: { ...supplier, products: productsList },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = updateSupplierSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, id), eq(suppliers.isDeleted, false)))
    .limit(1);

  if (!supplier) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const { productIds, ...updates } = parsed.data;

  if (updates.email && updates.email !== supplier.email) {
    const existing = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.email, updates.email), eq(suppliers.isDeleted, false)))
      .limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ ok: false, error: "EMAIL_EXISTS" }, { status: 409 });
    }
  }

  let uniqueProductIds: string[] | undefined;
  if (productIds !== undefined) {
    uniqueProductIds = [...new Set(productIds)];
    if (uniqueProductIds.length > 0) {
      const found = await db
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            inArray(products.id, uniqueProductIds),
            eq(products.branchId, session.user.branchId),
            eq(products.isDeleted, false),
          ),
        );
      if (found.length !== uniqueProductIds.length) {
        return NextResponse.json({ ok: false, error: "PRODUCT_NOT_FOUND" }, { status: 400 });
      }
    }
  }

  const [updated] = await db
    .update(suppliers)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(suppliers.id, id), eq(suppliers.isDeleted, false)))
    .returning();

  if (uniqueProductIds !== undefined) {
    await db.delete(supplierProducts).where(eq(supplierProducts.supplierId, id));
    if (uniqueProductIds.length > 0) {
      await db.insert(supplierProducts).values(
        uniqueProductIds.map((productId) => ({ supplierId: id, productId }))
      );
    }
  }

  await audit({
    entityType: "Supplier",
    entityId: id,
    action: "update",
    description: `Updated supplier: ${supplier.name}`,
    oldValues: { name: supplier.name, email: supplier.email, phone: supplier.phone },
    newValues: updates,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: null,
  });

  return NextResponse.json({ ok: true, supplier: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;
  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, id), eq(suppliers.isDeleted, false)))
    .limit(1);

  if (!supplier) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const [updated] = await db
    .update(suppliers)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(and(eq(suppliers.id, id), eq(suppliers.isDeleted, false)))
    .returning();

  await audit({
    entityType: "Supplier",
    entityId: id,
    action: "soft_delete",
    description: `Soft-deleted supplier: ${supplier.name}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: null,
  });

  return NextResponse.json({ ok: true, supplier: updated });
}
