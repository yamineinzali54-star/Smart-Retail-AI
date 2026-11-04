import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { permissions } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const ACTION_KEYS = [
  "discount.approve",
  "refund.approve",
  "transfer.approve",
  "void.approve",
  "supplier_return.confirm",
] as const;

const ROLES = ["admin", "inventory", "cashier"] as const;

const toggleSchema = z.object({
  role: z.enum(ROLES),
  actionKey: z.enum(ACTION_KEYS),
  isAllowed: z.boolean(),
});

// Fine-grained RBAC overrides (§2.1) — admin-only management.
export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const rows = await db.select().from(permissions);
  const matrix: Record<string, Record<string, boolean>> = {};
  for (const key of ACTION_KEYS) {
    matrix[key] = { admin: true, inventory: false, cashier: false };
  }
  for (const row of rows) {
    if (matrix[row.actionKey]) {
      matrix[row.actionKey][row.role] = row.isAllowed;
    }
  }
  return NextResponse.json({ ok: true, permissions: matrix, actionKeys: [...ACTION_KEYS] });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = toggleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { role, actionKey, isAllowed } = parsed.data;

  const [existing] = await db
    .select()
    .from(permissions)
    .where(and(eq(permissions.role, role), eq(permissions.actionKey, actionKey)))
    .limit(1);

  if (existing) {
    await db
      .update(permissions)
      .set({ isAllowed })
      .where(eq(permissions.id, existing.id));
  } else {
    await db.insert(permissions).values({ role, actionKey, isAllowed });
  }

  await audit({
    entityType: "Permission",
    entityId: `${role}:${actionKey}`,
    action: "update",
    description: `Set permission ${actionKey} for ${role} = ${isAllowed}`,
    oldValues: { isAllowed: existing?.isAllowed ?? null },
    newValues: { isAllowed },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true });
}
