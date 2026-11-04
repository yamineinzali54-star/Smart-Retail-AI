// Fast, DB-free: journal balance invariant (Batch 1 GL core rule — every
// posting must balance, debits == credits, before touching the ledger).
import { describe, expect, it } from "vitest";

import { normalizeLines, validateBalanced } from "@/lib/gl-math";

describe("validateBalanced", () => {
  it("accepts a balanced sale posting", () => {
    const lines = normalizeLines([
      { accountCode: "1000", debit: "10450.00" },
      { accountCode: "4000", credit: "9952.38" },
      { accountCode: "2100", credit: "497.62" },
    ]);
    const check = validateBalanced(lines);
    expect(check.ok).toBe(true);
    expect(check.debits).toBe("10450.00");
    expect(check.credits).toBe("10450.00");
  });

  it("rejects unbalanced input", () => {
    const check = validateBalanced(
      normalizeLines([
        { accountCode: "1000", debit: "100.00" },
        { accountCode: "4000", credit: "99.00" },
      ]),
    );
    expect(check.ok).toBe(false);
  });

  it("rejects empty journals", () => {
    expect(validateBalanced([]).ok).toBe(false);
  });

  it("normalizes missing legs to zero", () => {
    const [line] = normalizeLines([{ accountCode: "1200", debit: "50" }]);
    expect(line.debit).toBe("50.00");
    expect(line.credit).toBe("0.00");
  });
});
