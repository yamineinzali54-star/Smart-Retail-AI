import "server-only";

import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { getSession } from "@/lib/auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { id } = await params;

  const activities = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.userId, id))
    .orderBy(desc(auditLogs.createdAt))
    .limit(50);

  return NextResponse.json({ ok: true, activities });
}
