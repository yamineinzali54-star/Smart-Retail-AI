import Decimal from "decimal.js";

// DB-free journal math (unit-testable without a database connection).

export interface NormalizedLine {
  accountCode: string;
  debit: string;
  credit: string;
}

export interface JournalLineInput {
  accountCode: string;
  debit?: string;
  credit?: string;
}

export function normalizeLines(lines: JournalLineInput[]): NormalizedLine[] {
  return lines.map((l) => ({
    accountCode: l.accountCode,
    debit: new Decimal(l.debit ?? "0").toFixed(2),
    credit: new Decimal(l.credit ?? "0").toFixed(2),
  }));
}

export function validateBalanced(lines: NormalizedLine[]): {
  ok: boolean;
  debits: string;
  credits: string;
} {
  const debits = lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
  const credits = lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));
  return {
    ok: debits.equals(credits) && lines.length > 0,
    debits: debits.toFixed(2),
    credits: credits.toFixed(2),
  };
}
