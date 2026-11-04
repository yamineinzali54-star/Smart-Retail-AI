import "server-only";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { counters } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

const createCounterSchema = z.object({
  name: z.string().min(1).max(50),
  location: z.string().max(100).optional().nullable(),
  branchId: z.string().uuid(),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status:401 });
  }

  const { page, pageSize } = getPaginationParams(new URL(req.url).searchParams);
  const allCounters = await db.select().from(counters).where(eq(counters.isDeleted, false));
  const result = paginateArray(allCounters, page, pageSize);
  return NextResponse.json({ ok: true, counters: result.items, ...result.pagination });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createCounterSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const [newCounter] = await db
    .insert(counters)
    .values({
      name: parsed.data.name,
      location: parsed.data.location ?? null,
      branchId: parsed.data.branchId,
      isActive: true,
    })
    .returning();

  await audit({
    entityType: "Counter",
    entityId: newCounter.id,
    action: "create",
    description: `Created counter: ${parsed.data.name}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: null,
  });

  return NextResponse.json({ ok: true, counter: newCounter }, { status: 201 });
}
