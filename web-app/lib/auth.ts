import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { compare, hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import * as jose from "jose";

import { db } from "@/db";
import { authSessions, users } from "@/db/schema";

// ---------------------------------------------------------------------------
// Token model: short-lived access JWT (1h, stateless) + rotating opaque
// refresh token (7d, server-side in auth_session).
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "srai_session";
export const REFRESH_COOKIE = "srai_refresh";

export type SessionRole = "admin" | "inventory" | "cashier";

export interface Session {
  user: {
    id: string;
    userName: string;
    role: SessionRole;
    branchId: string;
  };
  sessionId: string;
  expiresAt: number;
}

export function accessTokenTtlSeconds(): number {
  const raw = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? "3600");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3600;
}

export function refreshTokenTtlSeconds(): number {
  const raw = Number(process.env.REFRESH_TOKEN_TTL_SECONDS ?? "604800");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 604800;
}

/**
 * Idle timeout (Phase 12 hardening): a refresh is rejected when the session
 * saw no rotation for longer than this. Default 30 minutes. The client
 * refresher stops pinging while the user is inactive, so the access token
 * lapses; this server-side check is the backstop.
 */
export function idleTimeoutSeconds(): number {
  const raw = Number(process.env.IDLE_TIMEOUT_SECONDS ?? "1800");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1800;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is not set (min 32 chars).");
  }
  return new TextEncoder().encode(secret);
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function signAccessToken(session: Session): Promise<string> {
  return new jose.SignJWT({
    sub: session.user.id,
    userName: session.user.userName,
    role: session.user.role,
    branchId: session.user.branchId,
    sid: session.sessionId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + accessTokenTtlSeconds())
    .sign(getSecretKey());
}

export async function verifyAccessToken(
  token: string,
): Promise<Session | null> {
  try {
    const { payload } = await jose.jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
    });
    const role = payload["role"];
    if (
      typeof payload.sub !== "string" ||
      typeof payload["userName"] !== "string" ||
      typeof payload["branchId"] !== "string" ||
      typeof payload["sid"] !== "string" ||
      (role !== "admin" && role !== "inventory" && role !== "cashier") ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }
    return {
      user: {
        id: payload.sub,
        userName: payload["userName"] as string,
        role,
        branchId: payload["branchId"] as string,
      },
      sessionId: payload["sid"] as string,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyAccessToken(token);
}

const isProd = process.env.NODE_ENV === "production";

export async function setAccessCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: accessTokenTtlSeconds(),
  });
}

export async function setRefreshCookie(token: string): Promise<void> {
  const store = await cookies();
  // Scoped to the auth API so the long-lived token isn't sent with every request.
  store.set(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/api/auth",
    maxAge: refreshTokenTtlSeconds(),
  });
}

export async function clearAuthCookies(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  // Path must match setRefreshCookie or the cookie survives.
  store.delete({ name: REFRESH_COOKIE, path: "/api/auth" });
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 10);
}

export async function comparePassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return compare(password, passwordHash);
}

// §10 fix: every audit entry carries the request IP.
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return h.get("x-real-ip")?.trim() || "unknown";
}

export async function getUserAgent(): Promise<string | null> {
  const h = await headers();
  return h.get("user-agent")?.slice(0, 255) ?? null;
}

// ---------------------------------------------------------------------------
// Session lifecycle (DB-backed refresh tokens)
// ---------------------------------------------------------------------------

export interface SessionUser {
  id: string;
  userName: string;
  role: SessionRole;
  branchId: string;
}

/** Create auth_session row + set both cookies. Returns the access Session. */
export async function issueSession(
  user: SessionUser,
  opts?: { ipAddress?: string | null; userAgent?: string | null; branchId?: string | null },
): Promise<Session> {
  const refreshToken = newRefreshToken();
  const now = new Date();
  const activeBranchId = opts?.branchId ?? user.branchId;
  const [row] = await db
    .insert(authSessions)
    .values({
      userId: user.id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(now.getTime() + refreshTokenTtlSeconds() * 1000),
      branchId: activeBranchId,
      ipAddress: opts?.ipAddress ?? null,
      userAgent: opts?.userAgent ?? null,
    })
    .returning({ id: authSessions.id });

  const session: Session = {
    user: { ...user, branchId: activeBranchId },
    sessionId: row.id,
    expiresAt: Math.floor(Date.now() / 1000) + accessTokenTtlSeconds(),
  };
  await setAccessCookie(await signAccessToken(session));
  await setRefreshCookie(refreshToken);
  return session;
}

export type RefreshResult =
  | { ok: true; session: Session }
  | { ok: false; error: "NO_REFRESH_TOKEN" | "INVALID_REFRESH_TOKEN" | "SESSION_IDLE_TIMEOUT" };

/**
 * Rotate the refresh token: revoke the presented one, issue a fresh pair.
 * Reuse of an already-rotated (revoked, unexpired) token = suspected theft:
 * revoke ALL of the user's sessions and reject.
 */
export async function rotateSession(
  presentedToken: string | undefined,
  opts?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<RefreshResult> {
  if (!presentedToken) return { ok: false, error: "NO_REFRESH_TOKEN" };

  const [row] = await db
    .select()
    .from(authSessions)
    .where(eq(authSessions.refreshTokenHash, hashRefreshToken(presentedToken)))
    .limit(1);

  if (!row) return { ok: false, error: "INVALID_REFRESH_TOKEN" };

  const now = new Date();
  if (row.revokedAt && row.expiresAt > now) {
    // Token was already rotated but is presented again → possible theft.
    await db
      .update(authSessions)
      .set({ revokedAt: now })
      .where(eq(authSessions.userId, row.userId));
    return { ok: false, error: "INVALID_REFRESH_TOKEN" };
  }
  if (row.revokedAt || row.expiresAt <= now) {
    return { ok: false, error: "INVALID_REFRESH_TOKEN" };
  }

  const lastActive = row.lastUsedAt ?? row.createdAt;
  if (now.getTime() - lastActive.getTime() > idleTimeoutSeconds() * 1000) {
    await db
      .update(authSessions)
      .set({ revokedAt: now })
      .where(eq(authSessions.id, row.id));
    return { ok: false, error: "SESSION_IDLE_TIMEOUT" };
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  if (!user || !user.isActive) {
    await db
      .update(authSessions)
      .set({ revokedAt: now })
      .where(eq(authSessions.id, row.id));
    return { ok: false, error: "INVALID_REFRESH_TOKEN" };
  }

  // Rotate: revoke old, insert new (a fresh row id becomes the new sid).
  const nextRefresh = newRefreshToken();
  await db
    .update(authSessions)
    .set({ revokedAt: now, lastUsedAt: now })
    .where(eq(authSessions.id, row.id));
  const [fresh] = await db
    .insert(authSessions)
    .values({
      userId: user.id,
      refreshTokenHash: hashRefreshToken(nextRefresh),
      expiresAt: new Date(now.getTime() + refreshTokenTtlSeconds() * 1000),
      // Preserve the session's active branch across rotation (branch switcher);
      // legacy rows without one fall back to the home branch.
      branchId: row.branchId ?? user.branchId,
      ipAddress: opts?.ipAddress ?? null,
      userAgent: opts?.userAgent ?? null,
    })
    .returning({ id: authSessions.id });

  const session: Session = {
    user: {
      id: user.id,
      userName: user.userName,
      role: user.role as SessionRole,
      branchId: row.branchId ?? user.branchId,
    },
    sessionId: fresh.id,
    expiresAt: Math.floor(Date.now() / 1000) + accessTokenTtlSeconds(),
  };
  await setAccessCookie(await signAccessToken(session));
  await setRefreshCookie(nextRefresh);
  return { ok: true, session };
}

/** Revoke every session of a user (logout + theft response). */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(eq(authSessions.userId, userId));
}
