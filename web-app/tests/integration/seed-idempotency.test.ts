// Database harness: seed idempotency (§13).
// runSeed() twice in-process — counts must be exactly the seed baseline.
import "../env";

import { describe, expect, it } from "vitest";

import { runSeed } from "@/db/seed";

const BASELINE = {
  branch: 1,
  users: 3,
  counters: 2,
  categories: 1,
  units: 1,
  permissions: 18,
};

describe("seed idempotency", () => {
  it("converges to the baseline on first run", async () => {
    const summary = await runSeed();
    expect(summary).toMatchObject(BASELINE);
  });

  it("is a no-op on repeat runs (no duplicates)", async () => {
    const before = await runSeed();
    const after = await runSeed();
    expect(after).toEqual(before);
    expect(after).toMatchObject(BASELINE);
  });
});
