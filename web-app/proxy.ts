import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import * as jose from "jose";

// Next.js 16 Proxy (replaces deprecated middleware.ts) — default-deny auth
// gate (PROJECT_PLAN.md §2 fix). Every route + API route requires a valid
// session JWT except the explicit public allowlist below.
//
// The access JWT is short-lived (1h); signature + exp are verified here.
// Refresh-token revocation is enforced at /api/auth/refresh, and the
// SessionRefresher keeps active tabs fresh without user interaction.
//
// Edge-safe: only jose (WebCrypto) is imported here — never db/bcrypt/otplib.

const SESSION_COOKIE = "srai_session";

const LEGACY_DASHBOARD_REDIRECTS: Record<string, string> = {
  "/dashboard/admin": "/admin",
  "/dashboard/inventory": "/inventory",
  "/dashboard/cashier": "/pos",
};

function getSecretKey(): Uint8Array | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

async function hasValidSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const key = getSecretKey();
  if (!key) return false;
  try {
    const { payload } = await jose.jwtVerify(token, key, {
      algorithms: ["HS256"],
    });
    const role = payload["role"];
    return (
      typeof payload.sub === "string" &&
      typeof payload["userName"] === "string" &&
      typeof payload["branchId"] === "string" &&
      (role === "admin" || role === "inventory" || role === "cashier")
    );
  } catch {
    return false;
  }
}

function isPublicPath(pathname: string): boolean {
  // Login UI + auth API handle their own credential checks.
  // Account page is protected (requires auth).
  // PWA manifest is static metadata — browsers fetch it without a session.
  return (
    pathname === "/login" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/api/auth/") ||
    // Secret-gated machine endpoints (no user session by design — each route
    // enforces its own Bearer secret and 401s without it):
    // - /api/cron/* → CRON_SECRET (external schedulers)
    pathname.startsWith("/api/cron/") ||
    // Public customer surfaces: e-receipts + counter display (read-only,
    // minimal fields — handlers enforce the field allowlist).
    pathname.startsWith("/r/") ||
    pathname.startsWith("/display/") ||
    pathname.startsWith("/customer/receipt/") ||
    pathname.startsWith("/api/public/")
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const canonicalPath = LEGACY_DASHBOARD_REDIRECTS[pathname];
  if (canonicalPath) {
    return NextResponse.redirect(new URL(canonicalPath, request.url));
  }

  if (isPublicPath(pathname)) {
    // Authenticated users don't need the login page.
    if (pathname === "/login" && (await hasValidSession(request))) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!(await hasValidSession(request))) {
    // Machine-readable backup export: the route accepts CRON_SECRET bearer
    // for schedulers (admin session also works). Restore stays session-only.
    if (pathname === "/api/admin/backup" && request.method === "GET") {
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHENTICATED" },
        { status: 401 },
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml)$).*)",
  ],
};
