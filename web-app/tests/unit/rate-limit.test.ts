// Fast, DB-free: login rate-limit memory path (§14.1).
// REDIS_URL is the localhost placeholder in dev, so these exercise the
// in-memory fallback with unique keys per test (isolated, no leakage).
import { describe, expect, it } from "vitest";

import {
  clearLoginFailures,
  isLoginBlocked,
  recordLoginFailure,
} from "@/lib/rate-limit";

describe("login rate limit (memory fallback)", () => {
  it("allows the first 5 failures, blocks from the 6th", async () => {
    const key = `unit-probe-${Date.now()}-a`;
    for (let i = 0; i < 5; i++) {
      const r = await recordLoginFailure(key);
      expect(r.blocked).toBe(false);
    }
    expect(await isLoginBlocked(key)).toBe(true);
    const sixth = await recordLoginFailure(key);
    expect(sixth.blocked).toBe(true);
    expect(sixth.remaining).toBe(0);
  });

  it("resets after clearLoginFailures", async () => {
    const key = `unit-probe-${Date.now()}-b`;
    for (let i = 0; i < 5; i++) await recordLoginFailure(key);
    expect(await isLoginBlocked(key)).toBe(true);
    await clearLoginFailures(key);
    expect(await isLoginBlocked(key)).toBe(false);
  });

  it("tracks keys independently", async () => {
    const a = `unit-probe-${Date.now()}-c1`;
    const b = `unit-probe-${Date.now()}-c2`;
    for (let i = 0; i < 5; i++) await recordLoginFailure(a);
    expect(await isLoginBlocked(a)).toBe(true);
    expect(await isLoginBlocked(b)).toBe(false);
  });
});
