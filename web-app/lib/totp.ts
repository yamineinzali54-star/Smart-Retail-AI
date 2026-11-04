import "server-only";

import { generateSecret, generateURI, verify } from "otplib";

const ISSUER = "SmartRetailAI";

export function generateTotpSecret(): string {
  return generateSecret();
}

export function buildOtpAuthUrl(
  userName: string,
  secret: string,
): string {
  return generateURI({
    issuer: ISSUER,
    label: userName,
    secret,
  });
}

function asValid(result: unknown): boolean {
  if (typeof result === "boolean") return result;
  if (
    typeof result === "object" &&
    result !== null &&
    "valid" in result &&
    typeof (result as { valid: unknown }).valid === "boolean"
  ) {
    return (result as { valid: boolean }).valid;
  }
  return false;
}

export async function verifyTotpCode(
  secret: string,
  token: string,
): Promise<boolean> {
  const code = token.replace(/\s+/g, "");
  if (!/^\d{6,8}$/.test(code)) return false;
  try {
    return asValid(await verify({ secret, token: code }));
  } catch {
    return false;
  }
}

/** Test helper: mint the current code for a secret (E2E + enrollment check). */
export async function mintTotpCode(secret: string): Promise<string> {
  const { generate } = await import("otplib");
  return generate({ secret });
}
