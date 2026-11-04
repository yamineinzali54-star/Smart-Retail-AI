import "server-only";

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { cartItems, carts } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getActiveSession } from "@/lib/pos";

export async function GET() {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const active = await getActiveSession(session.user.id);
  if (!active || active.branchId !== session.user.branchId) {
    return NextResponse.json({ ok: false, error: "NO_ACTIVE_SESSION" }, { status: 409 });
  }

  const parked = await db
    .select({
      id: carts.id,
      label: carts.label,
      status: carts.status,
      createdAt: carts.createdAt,
      updatedAt: carts.updatedAt,
    })
    .from(carts)
    .where(and(eq(carts.posSessionId, active.id), eq(carts.status, "parked")))
    .orderBy(carts.updatedAt);

  // Do not show empty placeholder carts as resumable carts.
  const parkedIds = parked.map((cart) => cart.id);
  const lines = parkedIds.length
    ? await db
        .select({ cartId: cartItems.cartId })
        .from(cartItems)
        .where(inArray(cartItems.cartId, parkedIds))
    : [];
  const cartsWithItems = new Set(lines.map((line) => line.cartId));

  return NextResponse.json({ ok: true, parked: parked.filter((cart) => cartsWithItems.has(cart.id)) });
}
