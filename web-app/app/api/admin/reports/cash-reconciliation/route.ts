import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";

import { db } from "@/db";
import { posSessions, users, branches } from "@/db/schema";
import { getSession } from "@/lib/auth";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const cashierId = searchParams.get("cashierId");
  const branchId = searchParams.get("branchId");
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 100));

  const conditions = [eq(posSessions.status, "closed")];
  if (startDate) conditions.push(gte(posSessions.startTime, new Date(startDate)));
  if (endDate) conditions.push(lte(posSessions.startTime, new Date(endDate)));
  if (cashierId) conditions.push(eq(posSessions.userId, cashierId));
  if (branchId) conditions.push(eq(posSessions.branchId, branchId));
  if (session.user.role !== "admin") conditions.push(eq(posSessions.branchId, session.user.branchId));
  if (session.user.role !== "admin") conditions.push(eq(posSessions.userId, session.user.id));

  const reconciliation = await db
    .select({
      sessionId: posSessions.id,
      cashierName: users.fullName,
      branchName: branches.name,
      startTime: posSessions.startTime,
      endTime: posSessions.endTime,
      openingCash: posSessions.openingCash,
      expectedCash: posSessions.expectedClosingCash,
      actualCash: posSessions.actualClosingCash,
      difference: posSessions.cashDifference,
    })
    .from(posSessions)
    .leftJoin(users, eq(posSessions.userId, users.id))
    .leftJoin(branches, eq(posSessions.branchId, branches.id))
    .where(and(...conditions))
    .orderBy(posSessions.startTime)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, reconciliation, page, pageSize });
}
