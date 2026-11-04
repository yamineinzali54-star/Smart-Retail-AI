import "server-only";

import { sql } from "drizzle-orm";

// pg_cron helper functions — for self-hosted Postgres / RDS / Supabase only
// (NOT Neon: cron.database_name is locked to `postgres`, owned by
// cloud_admin — see db/cron/0002_neon_setup.sql). Scheduling matrix:
// - Long-running host (VPS/Docker `next start`) → internal scheduler
//   (lib/internal-cron.ts, started from instrumentation.ts). Default.
// - Serverless (Vercel) → Vercel Cron / external scheduler → /api/cron/alerts.
// - Self-hosted PG → pg_cron via db/cron/0001_setup.sql + these helpers.
// All paths converge on runAlertScan() (lib/alert-scan.ts).

export interface CronJob {
  jobid: number;
  schedule: string;
  command: string;
  database: string;
  active: boolean;
}

export async function listCronJobs(): Promise<CronJob[]> {
  const jobs = await sql`
    SELECT jobid, schedule, command, database, active
    FROM cron.job
    ORDER BY jobid
  `;
  return jobs as unknown as CronJob[];
}

export async function unscheduleCronJob(jobId: string | number): Promise<void> {
  await sql`SELECT cron.unschedule(${jobId})`;
}

export async function runCronJobNow(jobId: string | number): Promise<void> {
  await sql`SELECT cron.run(${jobId})`;
}

export async function isPgCronAvailable(): Promise<boolean> {
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
      ) as available
    `;
    return (result as unknown as Array<{ available: boolean }>)[0]?.available ?? false;
  } catch {
    return false;
  }
}
