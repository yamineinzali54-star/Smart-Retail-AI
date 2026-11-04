import "server-only";

import Redis from "ioredis";

// Login rate-limiting (§14.1): max 5 failed attempts per key per
// 15 minutes → 429 lockout. Backed by Redis when reachable; otherwise a
// process-local map (single-instance dev / Redis outage fallback — the limit
// degrades to per-instance, it never fails open to unlimited).
//
// The login route uses two buckets per attempt: "<user>|<ip>" (brute force
// on one account from one source) and "ip:<ip>" with a higher threshold
// (credential spraying across usernames). Keying only by username let an
// unauthenticated attacker lock a known account for every legitimate user.

const MAX_FAILS = 5;
const WINDOW_SECONDS = 15 * 60;

interface MemoryEntry {
  count: number;
  resetAt: number;
}

const memory = new Map<string, MemoryEntry>();

let redis: Redis | null = null;
let redisDeadUntil = 0;

function redisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  // Localhost placeholder from .env.example means "no Redis provisioned".
  if (!url || /localhost|127\.0\.0\.1/.test(url)) return null;
  return url;
}

function getRedis(): Redis | null {
  if (Date.now() < redisDeadUntil) return null;
  const url = redisUrl();
  if (!url) return null;
  if (!redis) {
    redis = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 500,
    });
    redis.on("error", () => {
      redisDeadUntil = Date.now() + 30_000;
    });
  }
  return redis;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("redis-timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function memoryRecord(
  key: string,
  maxFails: number,
): { blocked: boolean; remaining: number } {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + WINDOW_SECONDS * 1000 });
    return { blocked: false, remaining: maxFails - 1 };
  }
  entry.count += 1;
  return {
    blocked: entry.count > maxFails,
    remaining: Math.max(0, maxFails - entry.count),
  };
}

export async function recordLoginFailure(
  key: string,
  maxFails: number = MAX_FAILS,
): Promise<{ blocked: boolean; remaining: number }> {
  const client = getRedis();
  if (client) {
    try {
      const redisKey = `login-fail:${key}`;
      const count = await withTimeout(client.incr(redisKey), 500);
      if (count === 1) await withTimeout(client.expire(redisKey, WINDOW_SECONDS), 500);
      return {
        blocked: count > maxFails,
        remaining: Math.max(0, maxFails - count),
      };
    } catch {
      redisDeadUntil = Date.now() + 30_000;
    }
  }
  return memoryRecord(key, maxFails);
}

export async function clearLoginFailures(key: string): Promise<void> {
  memory.delete(key);
  const client = getRedis();
  if (client) {
    try {
      await withTimeout(client.del(`login-fail:${key}`), 500);
    } catch {
      redisDeadUntil = Date.now() + 30_000;
    }
  }
}

export async function isLoginBlocked(
  key: string,
  maxFails: number = MAX_FAILS,
): Promise<boolean> {
  const client = getRedis();
  if (client) {
    try {
      const count = await withTimeout(client.get(`login-fail:${key}`), 500);
      return Number(count ?? 0) >= maxFails;
    } catch {
      redisDeadUntil = Date.now() + 30_000;
    }
  }
  const entry = memory.get(key);
  return !!entry && entry.resetAt > Date.now() && entry.count >= maxFails;
}
