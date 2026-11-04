"use client";

// Proactive session keep-alive. Mounted once in the root layout:
// - every 15 min (and on tab focus) asks /api/auth/refresh for a rotation;
//   the endpoint is a no-op while the access token still has >10 min left,
//   so steady-state cost is one cheap request per 15 min, zero DB writes.
// - on a successful rotation after expiry, refreshes the router state so
//   server components re-render with the fresh session.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

const INTERVAL_MS = 15 * 60 * 1000;

export default function SessionRefresher() {
  const router = useRouter();
  const inFlight = useRef(false);
  // Idle timeout (Phase 12): any interaction resets the clock; the refresher
  // stops pinging while the user is inactive so the session lapses on its
  // own. The server enforces the same window at rotation as a backstop.
  const lastActivity = useRef(0);
  const idleTtlMs = useRef(30 * 60 * 1000);

  const ping = useCallback(async () => {
    if (inFlight.current) return;
    // Public pages (login) have no session — skip silently.
    if (window.location.pathname.startsWith("/login")) return;
    // Inactive user → let the session lapse (idle timeout).
    if (Date.now() - lastActivity.current > idleTtlMs.current) {
      router.push("/login");
      return;
    }
    inFlight.current = true;
    try {
      const res = await fetch("/api/auth/refresh", { method: "POST" });
      const idleTtl = Number(res.headers.get("x-idle-ttl"));
      if (Number.isFinite(idleTtl) && idleTtl > 0) {
        idleTtlMs.current = idleTtl * 1000;
      }
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as {
          refreshed?: boolean;
        } | null;
        if (data?.refreshed) router.refresh();
      } else if (res.status === 401) {
        // Refresh token dead (expired/revoked) → fall back to login.
        router.push("/login");
        router.refresh();
      }
    } catch {
      // Offline / transient — the next tick or 401-retry covers it.
    } finally {
      inFlight.current = false;
    }
  }, [router]);

  useEffect(() => {
    lastActivity.current = Date.now();
    const markActive = () => {
      lastActivity.current = Date.now();
    };
    const timer = window.setInterval(ping, INTERVAL_MS);
    const onFocus = () => void ping();
    window.addEventListener("focus", onFocus);
    window.addEventListener("mousemove", markActive, { passive: true });
    window.addEventListener("keydown", markActive);
    window.addEventListener("pointerdown", markActive, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void ping();
    });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("mousemove", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("pointerdown", markActive);
    };
  }, [ping]);

  return null;
}
