import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, ilike, or } from "drizzle-orm";

import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { getSession } from "@/lib/auth";

// Audit Log viewer (§7.15, §10) — admin read-only. Audit tables are
// immutable: no edit/delete endpoints exist by design.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams;
  const page = Math.max(1, Number(q.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(q.get("pageSize")) || 100));
  const entityType = q.get("entityType")?.trim();
  const action = q.get("action")?.trim();
  const userId = q.get("userId")?.trim();
  const branchId = q.get("branchId")?.trim();
  const search = q.get("search")?.trim();

  const conditions = [];
  if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
  if (action) conditions.push(eq(auditLogs.action, action));
  if (userId) conditions.push(eq(auditLogs.userId, userId));
  if (branchId) conditions.push(eq(auditLogs.branchId, branchId));
  if (search) {
    conditions.push(
      or(
        ilike(auditLogs.description, `%${search}%`),
        ilike(auditLogs.entityId, `%${search}%`),
      )!,
    );
  }

  const logs = await db
    .select({
      id: auditLogs.id,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      action: auditLogs.action,
      description: auditLogs.description,
      userId: auditLogs.userId,
      userName: users.userName,
      branchId: auditLogs.branchId,
      ipAddress: auditLogs.ipAddress,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.userId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, logs, page, pageSize });
}
