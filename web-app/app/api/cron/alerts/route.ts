import "server-only";

import { NextResponse } from "next/server";

import { runAlertScan } from "@/lib/alert-scan";

// Cron endpoint for scheduled alert scans (Vercel Cron / external scheduler).
// Scans ALL branches for low-stock and expiry alerts. The cron secret is
// validated via the Authorization header. Logic lives in lib/alert-scan.ts,
// shared with the internal scheduler — same dedupe, same result shape.
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const result = await runAlertScan();
  return NextResponse.json({ ok: true, skipped: result.skipped, branches: result.branches });
}
