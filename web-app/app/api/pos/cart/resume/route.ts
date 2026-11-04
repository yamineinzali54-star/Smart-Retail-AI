import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { cartItems, carts } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getActiveSession } from "@/lib/pos";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const cartId = typeof body?.cartId === "string" ? body.cartId : null;
  if (!cartId) {
    return NextResponse.json({ ok: false, error: "CART_ID_REQUIRED" }, { status: 400 });
  }

  const active = await getActiveSession(session.user.id);
  if (!active || active.branchId !== session.user.branchId) {
    return NextResponse.json({ ok: false, error: "NO_ACTIVE_SESSION" }, { status: 409 });
  }

  const [target] = await db
    .select()
    .from(carts)
    .where(
      and(
        eq(carts.id, cartId),
        eq(carts.posSessionId, active.id),
        eq(carts.status, "parked"),
      ),
    )
    .limit(1);

  if (!target) {
    return NextResponse.json({ ok: false, error: "PARKED_CART_NOT_FOUND" }, { status: 404 });
  }

  const [current] = await db
    .select()
    .from(carts)
    .where(and(eq(carts.posSessionId, active.id), eq(carts.status, "active")))
    .limit(1);

  await db.transaction(async (tx) => {
    if (current) {
      const [currentLine] = await tx
        .select({ id: cartItems.id })
        .from(cartItems)
        .where(eq(cartItems.cartId, current.id))
        .limit(1);
      if (currentLine) {
        await tx
          .update(carts)
          .set({ status: "parked", updatedAt: new Date() })
          .where(eq(carts.id, current.id));
      } else {
        await tx.delete(carts).where(eq(carts.id, current.id));
      }
    }
    await tx
      .update(carts)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(carts.id, target.id));
  });

  return NextResponse.json({ ok: true, cart: target });
}
