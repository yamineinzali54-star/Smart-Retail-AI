import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import Decimal from "decimal.js";

import { db } from "@/db";
import { expenses, pettyCashFloats, users } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

const issueSchema = z.object({
  holderUserId: z.string().uuid(),
  issuedAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  notes: z.string().max(255).optional(),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { page, pageSize } = getPaginationParams(new URL(req.url).searchParams);
  const rows = await db
    .select({
      id: pettyCashFloats.id,
      holderUserId: pettyCashFloats.holderUserId,
      holderName: users.fullName,
      issuedAmount: pettyCashFloats.issuedAmount,
      status: pettyCashFloats.status,
      returnedAmount: pettyCashFloats.returnedAmount,
      notes: pettyCashFloats.notes,
      createdAt: pettyCashFloats.createdAt,
    })
    .from(pettyCashFloats)
    .leftJoin(users, eq(pettyCashFloats.holderUserId, users.id))
    .where(eq(pettyCashFloats.branchId, session.user.branchId))
    .orderBy(desc(pettyCashFloats.createdAt));
  const result = paginateArray(rows, page, pageSize);
  return NextResponse.json({ ok: true, floats: result.items, ...result.pagination });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = issueSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (new Decimal(parsed.data.issuedAmount).lte(0)) {
    return NextResponse.json({ ok: false, error: "AMOUNT_MUST_BE_POSITIVE" }, { status: 400 });
  }

  const [holder] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, parsed.data.holderUserId), eq(users.branchId, session.user.branchId)))
    .limit(1);
  if (!holder) {
    return NextResponse.json({ ok: false, error: "HOLDER_NOT_FOUND" }, { status: 404 });
  }

  const [open] = await db
    .select({ id: pettyCashFloats.id })
    .from(pettyCashFloats)
    .where(
      and(
        eq(pettyCashFloats.holderUserId, holder.id),
        eq(pettyCashFloats.branchId, session.user.branchId),
        eq(pettyCashFloats.status, "open"),
      ),
    )
    .limit(1);
  if (open) {
    return NextResponse.json({ ok: false, error: "FLOAT_ALREADY_OPEN" }, { status: 409 });
  }

  const [float] = await db
    .insert(pettyCashFloats)
    .values({
      branchId: session.user.branchId,
      holderUserId: holder.id,
      issuedAmount: new Decimal(parsed.data.issuedAmount).toFixed(2),
      status: "open",
      notes: parsed.data.notes ?? null,
      createdBy: session.user.id,
    })
    .returning();

  await audit({
    entityType: "PettyCashFloat",
    entityId: float.id,
    action: "create",
    description: `Issued petty cash float ${float.issuedAmount}`,
    newValues: float,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, float }, { status: 201 });
}

// Close a float: spent (linked expenses) + returned must equal issued.
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = z
    .object({
      floatId: z.string().uuid(),
      returnedAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [float] = await db
    .select()
    .from(pettyCashFloats)
    .where(
      and(eq(pettyCashFloats.id, parsed.data.floatId), eq(pettyCashFloats.branchId, session.user.branchId)),
    )
    .limit(1);
  if (!float) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  if (float.status !== "open") {
    return NextResponse.json({ ok: false, error: "FLOAT_NOT_OPEN" }, { status: 400 });
  }

  const spent = await db
    .select({ amount: expenses.amount })
    .from(expenses)
    .where(eq(expenses.floatId, float.id));
  const spentTotal = spent.reduce((s, r) => s.plus(r.amount), new Decimal(0));
  const expected = new Decimal(float.issuedAmount).minus(spentTotal);
  const returned = new Decimal(parsed.data.returnedAmount);
  if (!returned.equals(expected)) {
    return NextResponse.json(
      {
        ok: false,
        error: "CLOSE_MISMATCH",
        issued: float.issuedAmount,
        spent: spentTotal.toFixed(2),
        expectedReturn: expected.toFixed(2),
      },
      { status: 409 },
    );
  }

  const [closed] = await db
    .update(pettyCashFloats)
    .set({ status: "closed", returnedAmount: returned.toFixed(2), closedAt: new Date() })
    .where(eq(pettyCashFloats.id, float.id))
    .returning();

  await audit({
    entityType: "PettyCashFloat",
    entityId: float.id,
    action: "close",
    description: `Closed petty cash float (issued ${float.issuedAmount}, spent ${spentTotal.toFixed(2)})`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, float: closed });
}
