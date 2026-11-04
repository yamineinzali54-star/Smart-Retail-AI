// Fast, DB-free: TOTP helpers (otplib v13 functional API).
import { describe, expect, it } from "vitest";

import {
  buildOtpAuthUrl,
  generateTotpSecret,
  mintTotpCode,
  verifyTotpCode,
} from "@/lib/totp";

describe("totp helpers", () => {
  it("generates a Base32 secret", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  it("builds a scannable otpauth:// URL", () => {
    const url = buildOtpAuthUrl("admin1", "JBSWY3DPEHPK3PXP");
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    expect(url).toContain("JBSWY3DPEHPK3PXP");
  });

  it("verifies a freshly minted code", async () => {
    const secret = generateTotpSecret();
    const code = await mintTotpCode(secret);
    expect(await verifyTotpCode(secret, code)).toBe(true);
  });

  it("rejects wrong and malformed codes", async () => {
    const secret = generateTotpSecret();
    expect(await verifyTotpCode(secret, "000000")).toBe(false);
    expect(await verifyTotpCode(secret, "abcdef")).toBe(false);
    expect(await verifyTotpCode(secret, "")).toBe(false);
  });
});
