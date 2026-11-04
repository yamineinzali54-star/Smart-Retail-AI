import "server-only";

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { glAccounts } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getPaginationParams, paginateArray } from "@/lib/pagination";

const createAccountSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(150),
  type: z.enum(["asset", "liability", "equity", "income", "expense"]),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const { page, pageSize } = getPaginationParams(new URL(req.url).searchParams);
  const rows = await db
    .select()
    .from(glAccounts)
    .where(eq(glAccounts.isDeleted, false))
    .orderBy(asc(glAccounts.code));
  const result = paginateArray(rows, page, pageSize);
  return NextResponse.json({ ok: true, accounts: result.items, ...result.pagination });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createAccountSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select({ id: glAccounts.id })
    .from(glAccounts)
    .where(eq(glAccounts.code, parsed.data.code))
    .limit(1);
  if (existing) {
    return NextResponse.json({ ok: false, error: "CODE_EXISTS" }, { status: 409 });
  }

  const [account] = await db.insert(glAccounts).values(parsed.data).returning();

  await audit({
    entityType: "GLAccount",
    entityId: account.id,
    action: "create",
    description: `Created GL account ${account.code} — ${account.name}`,
    newValues: account,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, account }, { status: 201 });
}
