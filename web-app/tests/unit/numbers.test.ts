// Fast, DB-free: numbering conventions (PROJECT_PLAN.md §5).
import { describe, expect, it } from "vitest";

import {
  buildPurchaseOrderNumber,
  buildSaleNumber,
} from "@/lib/numbers";

describe("buildPurchaseOrderNumber", () => {
  it("formats PO-{branchCode}-{yyyyMMddHHmmss}", () => {
    const d = new Date(2026, 9, 5, 14, 32, 10); // local ctor — format only
    expect(buildPurchaseOrderNumber("YGN", d)).toBe("PO-YGN-20261005143210");
  });

  it("embeds the branch code", () => {
    expect(buildPurchaseOrderNumber("MDY", new Date())).toMatch(/^PO-MDY-\d{14}$/);
  });
});

describe("buildSaleNumber", () => {
  it("formats SALE-{branchCode}-{yyyyMMdd}-{seq:4} with zero-padding", () => {
    const d = new Date(2026, 9, 5);
    expect(buildSaleNumber("YGN", d, 42)).toBe("SALE-YGN-20261005-0042");
  });

  it("pads small sequences to 4 digits", () => {
    expect(buildSaleNumber("YGN", new Date(2026, 9, 5), 1)).toMatch(
      /^SALE-YGN-20261005-0001$/,
    );
  });
});
