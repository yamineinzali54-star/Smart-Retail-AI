import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { permissions } from "@/db/schema";
import type { SessionRole } from "@/lib/auth";

// PROJECT_PLAN.md §2.1 defaults — fallback when the permissions table has no
// row (e.g. seed not run). Admin is always allowed.
const DEFAULTS: Record<string, Record<SessionRole, boolean>> = {
  "discount.approve": { admin: true, inventory: false, cashier: false },
  "refund.approve": { admin: true, inventory: false, cashier: false },
  "transfer.approve": { admin: true, inventory: true, cashier: false },
  "void.approve": { admin: true, inventory: false, cashier: false },
  "supplier_return.confirm": { admin: true, inventory: false, cashier: false },
};

export async function hasPermission(
  role: SessionRole,
  actionKey: string,
): Promise<boolean> {
  if (role === "admin") return true;
  try {
    const [row] = await db
      .select({ isAllowed: permissions.isAllowed })
      .from(permissions)
      .where(and(eq(permissions.role, role), eq(permissions.actionKey, actionKey)))
      .limit(1);
    if (row) return row.isAllowed;
  } catch {
    // Fall through to plan defaults.
  }
  return DEFAULTS[actionKey]?.[role] ?? false;
}
