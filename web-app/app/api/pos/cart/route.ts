import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  branches,
  cartItems,
  carts,
  categories,
  items,
  products,
} from "@/db/schema";
import { getSession } from "@/lib/auth";
import { computeCartTotals, getActivePromos, getActiveSession, type PosCartLine } from "@/lib/pos";

const addSchema = z.object({
  productId: z.string().uuid(),
  itemId: z.string().uuid(),
  quantity: z.number().int().min(1),
});

const updateSchema = z.object({
  cartItemId: z.string().uuid(),
  quantity: z.number().int().min(1),
});

async function loadTotals(cartId: string, branchId: string, roundingUnit: number) {
  const rows = await db
    .select({
      id: cartItems.id,
      productId: cartItems.productId,
      itemId: cartItems.itemId,
      productName: products.name,
      barcode: items.barcode,
      currentSellingPrice: items.sellingPrice,
      quantity: cartItems.quantity,
      unitPrice: cartItems.unitPrice,
      categoryId: products.categoryId,
      taxRate: categories.taxRate,
      isTaxExempt: categories.isTaxExempt,
    })
    .from(cartItems)
    .innerJoin(products, and(eq(cartItems.productId, products.id), eq(products.isDeleted, false)))
    .leftJoin(items, eq(cartItems.itemId, items.id))
    .leftJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.isDeleted, false)))
    .where(eq(cartItems.cartId, cartId));

  const lines: PosCartLine[] = rows.map((r) => ({
    productId: r.productId,
    itemId: r.itemId,
    quantity: r.quantity,
    // Checkout reprices from the live batch price, so show that same price here.
    // Fall back to the cart snapshot only if the batch row is missing.
    unitPrice: r.currentSellingPrice ?? r.unitPrice,
    categoryId: r.categoryId ?? "",
    taxRate: r.taxRate ?? "0",
    isTaxExempt: r.isTaxExempt ?? false,
  }));
  const promos = await getActivePromos(branchId);
  const totals = computeCartTotals(lines, promos, roundingUnit);
  return {
    items: rows.map((r, i) => ({ ...r, ...totals.lines[i] })),
    ...totals,
    lines: undefined,
  };
}

async function resolveCart(userId: string, branchId: string) {
  const active = await getActiveSession(userId);
  if (!active || active.branchId !== branchId) return null;
  const [cart] = await db
    .select()
    .from(carts)
    .where(and(eq(carts.posSessionId, active.id), eq(carts.status, "active")))
    .limit(1);
  if (cart) return { active, cart };
  const [created] = await db
    .insert(carts)
    .values({ posSessionId: active.id, status: "active" })
    .returning();
  return { active, cart: created };
}

// GET — cart with live promotion/tax/total evaluation.
export async function GET() {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const resolved = await resolveCart(session.user.id, session.user.branchId);
  if (!resolved) {
    return NextResponse.json({ ok: false, error: "NO_ACTIVE_SESSION" }, { status: 409 });
  }
  const [branch] = await db
    .select({ roundingUnit: branches.roundingUnit })
    .from(branches)
    .where(eq(branches.id, session.user.branchId))
    .limit(1);
  const cart = await loadTotals(resolved.cart.id, session.user.branchId, branch?.roundingUnit ?? 50);
  return NextResponse.json({ ok: true, cart });
}

// POST — AddToCart (merges same batch; validates live stock).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const resolved = await resolveCart(session.user.id, session.user.branchId);
  if (!resolved) {
    return NextResponse.json({ ok: false, error: "NO_ACTIVE_SESSION" }, { status: 409 });
  }

  const [batch] = await db
    .select()
    .from(items)
    .where(
      and(
        eq(items.id, parsed.data.itemId),
        eq(items.productId, parsed.data.productId),
        eq(items.branchId, session.user.branchId),
      ),
    )
    .limit(1);
  if (!batch) {
    return NextResponse.json({ ok: false, error: "BATCH_NOT_FOUND" }, { status: 404 });
  }

  const [existing] = await db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.cartId, resolved.cart.id), eq(cartItems.itemId, batch.id)))
    .limit(1);
  const newQty = (existing?.quantity ?? 0) + parsed.data.quantity;
  if (newQty > (batch.currentStockQuantity ?? 0)) {
    return NextResponse.json({ ok: false, error: "INSUFFICIENT_STOCK" }, { status: 409 });
  }

  if (existing) {
    await db
      .update(cartItems)
      .set({ quantity: newQty })
      .where(eq(cartItems.id, existing.id));
  } else {
    await db.insert(cartItems).values({
      cartId: resolved.cart.id,
      productId: batch.productId,
      itemId: batch.id,
      quantity: parsed.data.quantity,
      unitPrice: batch.sellingPrice,
    });
  }
  return NextResponse.json({ ok: true });
}

// PATCH — UpdateCart quantity.
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const resolved = await resolveCart(session.user.id, session.user.branchId);
  if (!resolved) {
    return NextResponse.json({ ok: false, error: "NO_ACTIVE_SESSION" }, { status: 409 });
  }

  const [line] = await db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.id, parsed.data.cartItemId), eq(cartItems.cartId, resolved.cart.id)))
    .limit(1);
  if (!line) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  const [batch] = await db
    .select({ currentStockQuantity: items.currentStockQuantity })
    .from(items)
    .where(eq(items.id, line.itemId))
    .limit(1);
  if (!batch || parsed.data.quantity > (batch.currentStockQuantity ?? 0)) {
    return NextResponse.json({ ok: false, error: "INSUFFICIENT_STOCK" }, { status: 409 });
  }

  await db
    .update(cartItems)
    .set({ quantity: parsed.data.quantity })
    .where(eq(cartItems.id, line.id));
  return NextResponse.json({ ok: true });
}

// DELETE — RemoveFromCart (?cartItemId=) or ClearCart (?clear=true).
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const resolved = await resolveCart(session.user.id, session.user.branchId);
  if (!resolved) {
    return NextResponse.json({ ok: false, error: "NO_ACTIVE_SESSION" }, { status: 409 });
  }
  const url = new URL(req.url);
  if (url.searchParams.get("clear") === "true") {
    await db.delete(cartItems).where(eq(cartItems.cartId, resolved.cart.id));
    return NextResponse.json({ ok: true });
  }
  const cartItemId = url.searchParams.get("cartItemId");
  if (!cartItemId) {
    return NextResponse.json({ ok: false, error: "CART_ITEM_ID_REQUIRED" }, { status: 400 });
  }
  await db
    .delete(cartItems)
    .where(and(eq(cartItems.id, cartItemId), eq(cartItems.cartId, resolved.cart.id)));
  return NextResponse.json({ ok: true });
}
