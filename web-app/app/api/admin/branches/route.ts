import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { branches } from "@/db/schema";
import { getSession, getClientIp } from "@/lib/auth";
import { audit } from "@/lib/audit";

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

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 100));

  const allBranches = await db
    .select()
    .from(branches)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, branches: allBranches, page, pageSize });
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
      { status: 400 },
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
    newValues: newBranch,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, branch: newBranch }, { status: 201 });
}
