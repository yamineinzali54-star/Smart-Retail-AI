import "server-only";

import { NextResponse } from "next/server";

import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { runAlertScan } from "@/lib/alert-scan";

// Alert scan (§6.14): creates low-stock + expiry notifications for the
// session branch. Idempotent per branch/type/day — an unread summary
// notification for today suppresses duplicates so scheduled scans never
// spam. Logic lives in lib/alert-scan.ts, shared with the cron endpoint and
// the internal scheduler.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const daysThreshold =
    typeof body?.daysThreshold === "number" && body.daysThreshold > 0
      ? Math.min(90, Math.floor(body.daysThreshold))
      : 30;

  const result = await runAlertScan({ branchId: session.user.branchId, daysThreshold });
  const mine = result.branches[session.user.branchId] ?? {
    lowStock: 0,
    expired: 0,
    expiringSoon: 0,
    notified: [],
  };

  await audit({
    entityType: "Notification",
    entityId: session.user.branchId,
    action: "create",
    description: `Alert scan: low=${mine.lowStock}, expired=${mine.expired}, soon=${mine.expiringSoon}`,
    newValues: { lowCount: mine.lowStock, expiredCount: mine.expired, soonCount: mine.expiringSoon, created: mine.notified },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({
    ok: true,
    lowStock: mine.lowStock,
    expired: mine.expired,
    expiringSoon: mine.expiringSoon,
    notified: mine.notified,
  });
}
