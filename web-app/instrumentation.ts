// Next.js server boot hook: starts the internal cron scheduler (daily alert
// scan) on long-running Node.js hosts. No-op on Edge runtime and when
// INTERNAL_CRON_ENABLED=false. Safe on serverless (timers freeze between
// invocations; use Vercel Cron → /api/cron/alerts there instead).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startInternalCron } = await import("./lib/internal-cron");
    startInternalCron();
  }
}
