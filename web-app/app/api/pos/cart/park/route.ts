import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { carts } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getActiveSession } from "@/lib/pos";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "cashier")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const active = await getActiveSession(session.user.id);
  if (!active || active.branchId !== session.user.branchId) {
    return NextResponse.json({ ok: false, error: "NO_ACTIVE_SESSION" }, { status: 409 });
  }

  const [current] = await db
    .select()
    .from(carts)
    .where(and(eq(carts.posSessionId, active.id), eq(carts.status, "active")))
    .limit(1);

  if (!current) {
    return NextResponse.json({ ok: false, error: "NO_ACTIVE_CART" }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const label = typeof body?.label === "string" ? body.label.slice(0, 100) : null;

  const fresh = await db.transaction(async (tx) => {
    await tx
      .update(carts)
      .set({ status: "parked", label, updatedAt: new Date() })
      .where(eq(carts.id, current.id));
    const [row] = await tx
      .insert(carts)
      .values({ posSessionId: active.id, status: "active" })
      .returning();
    return row;
  });

  return NextResponse.json({ ok: true, cart: fresh }, { status: 201 });
}
