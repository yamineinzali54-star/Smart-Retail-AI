import "server-only";

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { suppliers, supplierProducts, products } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(150),
  contactPerson: z.string().trim().max(100).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().email().max(150).optional().nullable(),
  address: z.string().trim().max(255).optional().nullable(),
  productIds: z.array(z.string().uuid()).default([]),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { page, pageSize } = getPaginationParams(new URL(req.url).searchParams);
  const allSuppliers = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.branchId, session.user.branchId), eq(suppliers.isDeleted, false)));

  const allSupplierProducts = await db
    .select()
    .from(supplierProducts);

  const allProducts = await db
    .select()
    .from(products)
    .where(and(eq(products.branchId, session.user.branchId), eq(products.isDeleted, false)));

  const suppliersWithProducts = allSuppliers.map((supplier) => {
    const supplierProductIds = allSupplierProducts
      .filter((sp) => sp.supplierId === supplier.id)
      .map((sp) => sp.productId);

    const supplierProductsList = allProducts
      .filter((p) => supplierProductIds.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name }));

    return {
      ...supplier,
      products: supplierProductsList,
    };
  });

  const result = paginateArray(suppliersWithProducts, page, pageSize);
  return NextResponse.json({ ok: true, suppliers: result.items, ...result.pagination });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createSupplierSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { name, contactPerson, phone, email, address, productIds } = parsed.data;

  if (email) {
    const existing = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.email, email))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ ok: false, error: "EMAIL_EXISTS" }, { status: 409 });
    }
  }

  const uniqueProductIds = [...new Set(productIds)];
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

  const [newSupplier] = await db
    .insert(suppliers)
    .values({
      branchId: session.user.branchId,
      name,
      contactPerson: contactPerson ?? null,
      phone: phone ?? null,
      email: email ?? null,
      address: address ?? null,
    })
    .returning();

  if (uniqueProductIds.length > 0) {
    await db.insert(supplierProducts).values(
      uniqueProductIds.map((productId) => ({ supplierId: newSupplier.id, productId }))
    );
  }

  await audit({
    entityType: "Supplier",
    entityId: newSupplier.id,
    action: "create",
    description: `Created supplier: ${name}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: null,
  });

  return NextResponse.json({ ok: true, supplier: newSupplier }, { status: 201 });
}
