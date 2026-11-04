import "server-only";

import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import type { AuditAction } from "@/lib/audit-types";

// Thin re-export so route handlers import audit + types from one place.
export type { AuditAction } from "@/lib/audit-types";

export async function audit(entry: {
  entityType: string;
  entityId: string;
  action: AuditAction;
  description?: string;
  oldValues?: unknown;
  newValues?: unknown;
  userId?: string | null;
  branchId?: string | null;
  ipAddress?: string | null;
}): Promise<void> {
  await db.insert(auditLogs).values({
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    description: entry.description ?? null,
    oldValues: (entry.oldValues ?? null) as never,
    newValues: (entry.newValues ?? null) as never,
    userId: entry.userId ?? null,
    branchId: entry.branchId ?? null,
    ipAddress: entry.ipAddress ?? null,
  });
}
