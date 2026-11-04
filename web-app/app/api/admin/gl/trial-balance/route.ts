import "server-only";

import { NextResponse } from "next/server";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/db";
import { glAccounts, journalEntries, journalLines } from "@/db/schema";
import { getSession } from "@/lib/auth";

// Trial balance: per-account debit/credit totals in range + overall balance check.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams;
  const branchId = q.get("branchId") ?? session.user.branchId;
  const startDate = q.get("startDate");
  const endDate = q.get("endDate");

  const entryConditions = [eq(journalEntries.branchId, branchId)];
  if (startDate) entryConditions.push(gte(journalEntries.entryDate, new Date(startDate)));
  if (endDate) entryConditions.push(lte(journalEntries.entryDate, new Date(endDate)));

  const rows = await db
    .select({
      accountId: journalLines.accountId,
      code: glAccounts.code,
      name: glAccounts.name,
      type: glAccounts.type,
      debits: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credits: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .leftJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .leftJoin(glAccounts, and(eq(journalLines.accountId, glAccounts.id), eq(glAccounts.isDeleted, false)))
    .where(and(...entryConditions))
    .groupBy(journalLines.accountId, glAccounts.code, glAccounts.name, glAccounts.type);

  let totalDebits = new Decimal(0);
  let totalCredits = new Decimal(0);
  const accounts = rows.map((r) => {
    totalDebits = totalDebits.plus(r.debits);
    totalCredits = totalCredits.plus(r.credits);
    const net = new Decimal(r.debits).minus(r.credits);
    return {
      accountId: r.accountId,
      code: r.code,
      name: r.name,
      type: r.type,
      debits: new Decimal(r.debits).toFixed(2),
      credits: new Decimal(r.credits).toFixed(2),
      balance: net.toFixed(2),
    };
  });

  return NextResponse.json({
    ok: true,
    accounts,
    totals: {
      debits: totalDebits.toFixed(2),
      credits: totalCredits.toFixed(2),
      balanced: totalDebits.equals(totalCredits),
    },
  });
}
