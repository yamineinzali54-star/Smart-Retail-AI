import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { units } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

const createUnitSchema = z.object({
  name: z.string().trim().min(1).max(50),
  shortName: z.string().trim().min(1).max(10),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const { page, pageSize } = getPaginationParams(new URL(req.url).searchParams);
  const allUnits = await db
    .select()
    .from(units)
    .where(and(eq(units.branchId, session.user.branchId), eq(units.isDeleted, false)));

  const result = paginateArray(allUnits, page, pageSize);
  return NextResponse.json({ ok: true, units: result.items, ...result.pagination });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createUnitSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { name, shortName } = parsed.data;

  const existing = await db
    .select({ id: units.id })
    .from(units)
    .where(eq(units.shortName, shortName))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ ok: false, error: "SHORT_NAME_EXISTS" }, { status: 409 });
  }

  const [newUnit] = await db
    .insert(units)
    .values({
      branchId: session.user.branchId,
      name,
      shortName,
    })
    .returning();

  await audit({
    entityType: "Unit",
    entityId: newUnit.id,
    action: "create",
    description: `Created unit: ${name}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: null,
  });

  return NextResponse.json({ ok: true, unit: newUnit }, { status: 201 });
}
