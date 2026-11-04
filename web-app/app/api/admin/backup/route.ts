import "server-only";

import { NextResponse } from "next/server";

import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { exportBackup } from "@/lib/backup";

// Off-platform backup export: full JSON snapshot of all 57 tables (see
// lib/backup.ts — the single source of truth for export + restore).
// Auth: admin session (UI download) OR CRON_SECRET bearer (schedulers — the
// internal nightly job and external cron call without a user session).
export async function GET(req: Request) {
  const session = await getSession();
  const cronSecret = process.env.CRON_SECRET;
  const cronAuth =
    !!cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`;
  if ((!session || session.user.role !== "admin") && !cronAuth) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const payload = await exportBackup();

  if (session) {
    await audit({
      entityType: "Backup",
      entityId: session.user.branchId,
      action: "create",
      description: `Exported full backup snapshot (${payload.rowCount} rows, ${payload.tableCount} tables)`,
      newValues: { rowCount: payload.rowCount, tableCount: payload.tableCount },
      userId: session.user.id,
      branchId: session.user.branchId,
      ipAddress: await getClientIp(),
    });
  }

  const stamp = payload.exportedAt.slice(0, 10).replace(/-/g, "");
  return new NextResponse(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename=smartretail-backup-${stamp}.json`,
    },
  });
}
