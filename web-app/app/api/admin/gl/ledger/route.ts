import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, gte, lte } from "drizzle-orm";

import { db } from "@/db";
import { glAccounts, journalEntries, journalLines } from "@/db/schema";
import { getSession } from "@/lib/auth";

// Account ledger: every line posted to one account with running context.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams;
  const accountId = q.get("accountId");
  if (!accountId) {
    return NextResponse.json({ ok: false, error: "ACCOUNT_ID_REQUIRED" }, { status: 400 });
  }
  const branchId = q.get("branchId") ?? session.user.branchId;
  const startDate = q.get("startDate");
  const endDate = q.get("endDate");
  const page = Math.max(1, Number(q.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(q.get("pageSize")) || 100));

  const [account] = await db
    .select({ id: glAccounts.id, code: glAccounts.code, name: glAccounts.name })
    .from(glAccounts)
    .where(and(eq(glAccounts.id, accountId), eq(glAccounts.isDeleted, false)))
    .limit(1);
  if (!account) {
    return NextResponse.json({ ok: false, error: "ACCOUNT_NOT_FOUND" }, { status: 404 });
  }

  const conditions = [eq(journalLines.accountId, accountId), eq(journalEntries.branchId, branchId)];
  if (startDate) conditions.push(gte(journalEntries.entryDate, new Date(startDate)));
  if (endDate) conditions.push(lte(journalEntries.entryDate, new Date(endDate)));

  const lines = await db
    .select({
      entryId: journalLines.entryId,
      debit: journalLines.debit,
      credit: journalLines.credit,
      entryDate: journalEntries.entryDate,
      refType: journalEntries.refType,
      refId: journalEntries.refId,
      memo: journalEntries.memo,
    })
    .from(journalLines)
    .leftJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(...conditions))
    .orderBy(desc(journalEntries.entryDate))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, account, lines, page, pageSize });
}
