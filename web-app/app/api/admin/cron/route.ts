import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import {
  isPgCronAvailable,
  listCronJobs,
  runCronJobNow,
  unscheduleCronJob,
} from "@/lib/cron";
import { INTERNAL_JOB_DEFS, isInternalCronEnabled } from "@/lib/internal-cron";

// GET /api/admin/cron — scheduler status: internal scheduler (primary on
// long-running hosts) + pg_cron jobs (self-hosted Postgres only).
export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const available = await isPgCronAvailable();
  return NextResponse.json({
    ok: true,
    internal: {
      enabled: isInternalCronEnabled(),
      note: "In-process scheduler (instrumentation.ts). Active on long-running hosts; frozen on serverless.",
      jobs: INTERNAL_JOB_DEFS,
    },
    pgCron: {
      available,
      jobs: available ? await listCronJobs() : [],
      note: available
        ? undefined
        : "pg_cron is unavailable on Neon by design (cron.database_name locked to cloud_admin-owned postgres). Use the internal scheduler or an external HTTP cron → /api/cron/alerts.",
    },
  });
}

// POST /api/admin/cron — run a job now
// Body: { jobId: string }
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const jobId = typeof body?.jobId === "string" ? body.jobId : null;
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "JOB_ID_REQUIRED" }, { status: 400 });
  }

  try {
    await runCronJobNow(jobId);
    return NextResponse.json({ ok: true, message: `Job ${jobId} triggered` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Run failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// DELETE /api/admin/cron — unschedule a job
// Body: { jobId: string }
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const jobId = typeof body?.jobId === "string" ? body.jobId : null;
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "JOB_ID_REQUIRED" }, { status: 400 });
  }

  try {
    await unscheduleCronJob(jobId);
    return NextResponse.json({ ok: true, message: `Job ${jobId} unscheduled` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unschedule failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
