import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { shiftRosters } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { id } = await params;

  const [existing] = await db
    .select({ id: shiftRosters.id })
    .from(shiftRosters)
    .where(and(eq(shiftRosters.id, id), eq(shiftRosters.branchId, session.user.branchId)))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  await db.delete(shiftRosters).where(eq(shiftRosters.id, id));

  await audit({
    entityType: "ShiftRoster",
    entityId: id,
    action: "delete",
    description: "Deleted roster entry",
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true });
}
