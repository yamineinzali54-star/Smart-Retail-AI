import "server-only";

import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runAlertScan } from "@/lib/alert-scan";
import { exportBackup } from "@/lib/backup";

// Internal cron — in-process scheduled jobs. Works on any long-running host
// (`next start` on a VPS/Docker, `next dev`) with zero external scheduler:
// pg_cron is unavailable on Neon and serverless platforms freeze timers, so
// this fills the gap for self-hosted deploys. Safe properties:
// - Singleton per process (globalThis guard survives dev HMR re-imports).
// - Single-flight across instances via a transaction-scoped advisory lock
//   inside runAlertScan (Neon HTTP is stateless — no session locks).
// - Idempotent scans: today-dedupe means overlapping runs never spam.
// - Catch-up: if the server was down at fire time, the first tick after boot
//   runs the missed job immediately instead of waiting another day.
// Disable everything with INTERNAL_CRON_ENABLED=false (e.g. when Vercel Cron
// or pg_cron already triggers the HTTP endpoints — overlap is harmless).
// Disable just disk backups with INTERNAL_BACKUP_ENABLED=false.

interface Job {
  name: string;
  hourUtc: number;
  minuteUtc: number;
  label: string;
  run: () => Promise<string>;
}

async function runBackupJob(): Promise<string> {
  const dir = process.env.BACKUP_DIR?.trim() || "./backups";
  const keep = Math.max(1, Number(process.env.BACKUP_RETENTION ?? 7) || 7);
  await mkdir(dir, { recursive: true });
  const payload = await exportBackup();
  const stamp = payload.exportedAt.replace(/[-:]/g, "").slice(0, 15);
  const file = join(dir, `smartretail-backup-${stamp}.json`);
  await writeFile(file, JSON.stringify(payload));
  // Retention: keep newest N snapshots.
  const entries = await readdir(/*turbopackIgnore: true*/ dir);
  const snaps = (
    await Promise.all(
      entries
        .filter((e) => e.startsWith("smartretail-backup-") && e.endsWith(".json"))
        .map(async (e) => ({
          e,
          mtime: (await stat(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, e))).mtimeMs,
        })),
    )
  ).sort((a, b) => b.mtime - a.mtime);
  for (const old of snaps.slice(keep)) {
    await unlink(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, old.e));
  }
  return `${file} (${payload.rowCount} rows, ${payload.tableCount} tables)`;
}

const JOBS: Job[] = [
  // 8:00 AM Myanmar (UTC+6:30) daily alert scan.
  {
    name: "alert-scan",
    hourUtc: 1,
    minuteUtc: 30,
    label: "Daily alert scan — 8:00 AM Myanmar",
    run: async () => {
      const r = await runAlertScan();
      return `skipped=${r.skipped} branches=${Object.keys(r.branches).length}`;
    },
  },
  // 2:00 AM Myanmar daily disk backup (19:30 UTC previous day).
  {
    name: "backup",
    hourUtc: 19,
    minuteUtc: 30,
    label: "Nightly disk backup — 2:00 AM Myanmar",
    run: async () => {
      if (process.env.INTERNAL_BACKUP_ENABLED === "false") return "disabled";
      return runBackupJob();
    },
  },
];

/** Static job metadata for status UIs (no timers involved). */
export const INTERNAL_JOB_DEFS = JOBS.map((j) => ({
  name: j.name,
  hourUtc: j.hourUtc,
  minuteUtc: j.minuteUtc,
  label: j.label,
}));

export function isInternalCronEnabled(): boolean {
  return process.env.INTERNAL_CRON_ENABLED !== "false";
}

// Random 0–60s stagger so two instances booted together rarely collide.
const MAX_STAGGER_MS = 60_000;

function msUntilNextRun(hourUtc: number, minuteUtc: number, from: Date = new Date()): number {
  const next = new Date(from);
  next.setUTCHours(hourUtc, minuteUtc, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - from.getTime();
}

export function startInternalCron(): void {
  if (!isInternalCronEnabled()) return;
  const g = globalThis as unknown as { __sraiInternalCron?: boolean };
  if (g.__sraiInternalCron) return;
  g.__sraiInternalCron = true;

  for (const job of JOBS) {
    const stagger = Math.floor(Math.random() * MAX_STAGGER_MS);

    async function tick(catchUp: boolean): Promise<void> {
      try {
        const detail = await job.run();
        console.log(`[internal-cron] job done: ${job.name} (catchUp=${catchUp}) ${detail}`);
      } catch (err) {
        console.error(`[internal-cron] job failed: ${job.name}`, err);
      } finally {
        scheduleJob(job, false);
      }
    }

    function scheduleJob(j: Job, catchUp: boolean): void {
      const now = new Date();
      const todayTarget = new Date(now);
      todayTarget.setUTCHours(j.hourUtc, j.minuteUtc, 0, 0);
      const missedToday = catchUp && now.getTime() > todayTarget.getTime();
      const delay = (missedToday ? 0 : msUntilNextRun(j.hourUtc, j.minuteUtc, now)) + stagger;
      setTimeout(() => void tick(false), delay);
    }

    scheduleJob(job, true);
  }

  console.log(`[internal-cron] scheduler started (${JOBS.map((j) => j.name).join(", ")})`);
}
