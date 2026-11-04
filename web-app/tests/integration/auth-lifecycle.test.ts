// Database harness: refresh-token lifecycle at the lib layer.
// next/headers is mocked with an in-memory cookie jar; the database is real.
// Cleans up every auth_session row it creates.
import "../env";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) as string } : undefined,
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string | { name: string }) => {
      jar.delete(typeof name === "string" ? name : name.name);
    },
  }),
  headers: async () => ({ get: () => null }),
}));

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { authSessions, users } from "@/db/schema";
import {
  issueSession,
  REFRESH_COOKIE,
  revokeAllUserSessions,
  rotateSession,
  SESSION_COOKIE,
  verifyAccessToken,
  type SessionRole,
} from "@/lib/auth";

let userId: string;
let branchId: string;
const preExisting = new Set<string>();

beforeAll(async () => {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.userName, "inventory1"))
    .limit(1);
  if (!user) throw new Error("seed user inventory1 missing — run db:seed first");
  userId = user.id;
  branchId = user.branchId;
  const rows = await db
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(eq(authSessions.userId, userId));
  for (const r of rows) preExisting.add(r.id);
});

afterAll(async () => {
  const rows = await db
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(eq(authSessions.userId, userId));
  const created = rows.map((r) => r.id).filter((id) => !preExisting.has(id));
  if (created.length > 0) {
    await db.delete(authSessions).where(inArray(authSessions.id, created));
  }
  jar.clear();
});

async function issue() {
  return issueSession(
    { id: userId, userName: "inventory1", role: "inventory" as SessionRole, branchId },
    { ipAddress: "127.0.0.1", userAgent: "vitest" },
  );
}

describe("refresh-token lifecycle", () => {
  it("issues a verifiable access token + refresh cookie", async () => {
    const session = await issue();
    expect(session.sessionId).toBeTruthy();
    const access = jar.get(SESSION_COOKIE);
    const refresh = jar.get(REFRESH_COOKIE);
    expect(access).toBeTruthy();
    expect(refresh).toBeTruthy();
    const verified = await verifyAccessToken(access!);
    expect(verified?.user.id).toBe(userId);
    expect(verified?.sessionId).toBe(session.sessionId);
  });

  it("rotates the pair and single-uses the old refresh token", async () => {
    await issue();
    const firstRefresh = jar.get(REFRESH_COOKIE)!;
    const rotated = await rotateSession(firstRefresh);
    expect(rotated.ok).toBe(true);
    const secondRefresh = jar.get(REFRESH_COOKIE)!;
    expect(secondRefresh).not.toBe(firstRefresh);
    if (rotated.ok) {
      expect(rotated.session.sessionId).toBeTruthy();
    }
  });

  it("rejects reuse of a rotated token and locks down the user", async () => {
    await issue();
    const firstRefresh = jar.get(REFRESH_COOKIE)!;
    const rotated = await rotateSession(firstRefresh);
    expect(rotated.ok).toBe(true);
    const secondRefresh = jar.get(REFRESH_COOKIE)!;

    const reuse = await rotateSession(firstRefresh);
    expect(reuse.ok).toBe(false);

    // Theft lockdown: even the newest token is now dead.
    const afterLockdown = await rotateSession(secondRefresh);
    expect(afterLockdown.ok).toBe(false);
  });

  it("revokeAllUserSessions kills refresh capability", async () => {
    await issue();
    const refresh = jar.get(REFRESH_COOKIE)!;
    await revokeAllUserSessions(userId);
    const res = await rotateSession(refresh);
    expect(res.ok).toBe(false);
  });

  it("rejects garbage tokens", async () => {
    expect(await verifyAccessToken("not-a-jwt")).toBeNull();
    const res = await rotateSession("not-a-token");
    expect(res.ok).toBe(false);
    const empty = await rotateSession(undefined);
    expect(empty.ok).toBe(false);
  });
});
