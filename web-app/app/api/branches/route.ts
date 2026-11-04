import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { branches } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

const createBranchSchema = z.object({
  code: z.string().min(2).max(4),
  name: z.string().min(1).max(100),
  cashDiscrepancyThreshold: z.string().optional(),
  roundingUnit: z.number().int().positive().optional(),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { page, pageSize } = getPaginationParams(new URL(req.url).searchParams);
  const allBranches = await db.select().from(branches);
  const result = paginateArray(allBranches, page, pageSize);
  return NextResponse.json({ ok: true, branches: result.items, ...result.pagination });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createBranchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const [newBranch] = await db
    .insert(branches)
    .values({
      code: parsed.data.code,
      name: parsed.data.name,
      cashDiscrepancyThreshold: parsed.data.cashDiscrepancyThreshold ?? "1000",
      roundingUnit: parsed.data.roundingUnit ?? 50,
    })
    .returning();

  await audit({
    entityType: "Branch",
    entityId: newBranch.id,
    action: "create",
    description: `Created branch: ${parsed.data.name}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: null,
  });

  return NextResponse.json({ ok: true, branch: newBranch }, { status: 201 });
}
