import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { glAccounts, journalEntries, journalLines } from "@/db/schema";

// ---------------------------------------------------------------------------
// General Ledger posting engine (Batch 1 — ERP financial core).
// Every posting is balanced (debits == credits) and written atomically.
// Pure math lives in gl-math.ts so unit tests need no database.
// ---------------------------------------------------------------------------

import { normalizeLines, validateBalanced } from "./gl-math";
import type { JournalLineInput } from "./gl-math";

export type { JournalLineInput, NormalizedLine } from "./gl-math";

export interface PostJournalInput {
  branchId: string;
  entryDate?: Date;
  refType: string;
  refId?: string | null;
  memo?: string | null;
  lines: JournalLineInput[];
  createdBy?: string | null;
}

type DbExecutor = Pick<typeof db, "insert" | "select">;

export async function postJournal(
  input: PostJournalInput,
  executor: DbExecutor = db,
): Promise<{ id: string }> {
  const normalized = normalizeLines(input.lines);
  const check = validateBalanced(normalized);
  if (!check.ok) {
    throw new Error(`UNBALANCED_JOURNAL: debits ${check.debits} != credits ${check.credits}`);
  }

  const codes = [...new Set(normalized.map((l) => l.accountCode))];
  const accounts = await executor
    .select({ id: glAccounts.id, code: glAccounts.code })
    .from(glAccounts)
    .where(eq(glAccounts.isDeleted, false));
  const idByCode = new Map(accounts.map((a) => [a.code, a.id]));
  const missing = codes.filter((c) => !idByCode.has(c));
  if (missing.length > 0) {
    throw new Error(`UNKNOWN_GL_ACCOUNTS: ${missing.join(", ")}`);
  }

  const [entry] = await executor
    .insert(journalEntries)
    .values({
      branchId: input.branchId,
      entryDate: input.entryDate ?? new Date(),
      refType: input.refType,
      refId: input.refId ?? null,
      memo: input.memo ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: journalEntries.id });

  await executor.insert(journalLines).values(
    normalized.map((l) => ({
      entryId: entry.id,
      accountId: idByCode.get(l.accountCode)!,
      debit: l.debit,
      credit: l.credit,
    })),
  );

  return { id: entry.id };
}

/** Exact reversal of a prior posting (voids, corrections). */
export async function reverseJournal(
  refType: string,
  refId: string,
  opts: { branchId: string; memo?: string; createdBy?: string | null },
  executor: DbExecutor = db,
): Promise<{ id: string } | null> {
  const [target] = await executor
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(and(eq(journalEntries.refType, refType), eq(journalEntries.refId, refId)))
    .limit(1);
  if (!target) return null;

  const lines = await executor
    .select({
      accountCode: glAccounts.code,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .leftJoin(glAccounts, and(eq(journalLines.accountId, glAccounts.id), eq(glAccounts.isDeleted, false)))
    .where(eq(journalLines.entryId, target.id));

  return postJournal(
    {
      branchId: opts.branchId,
      refType,
      refId: `${refId}:reversal`,
      memo: opts.memo ?? `Reversal of ${refType} ${refId}`,
      lines: lines.map((l) => ({
        accountCode: l.accountCode ?? "",
        debit: l.credit,
        credit: l.debit,
      })),
      createdBy: opts.createdBy ?? null,
    },
    executor,
  );
}


