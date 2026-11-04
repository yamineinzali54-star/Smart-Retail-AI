-- pg_cron setup for SmartRetailAI scheduled jobs (PRIMARY cron solution)
-- Run this migration after the main schema migrations.
--
-- Requires: PostgreSQL 15+ with pg_cron extension available
--           (self-hosted Postgres, AWS RDS, or Supabase — NOT Neon)
--
-- The cron jobs call the app's HTTP endpoints via net.http_post.
-- The app must be reachable at APP_URL (set below) when jobs fire.

-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Configure the app URL and cron secret for HTTP calls
-- Replace with your actual deployment URL and a strong secret
ALTER SYSTEM SET app.cron_secret = 'CHANGE_ME_TO_A_RANDOM_STRING';
ALTER SYSTEM SET app.url = 'http://localhost:3000';

-- Schedule the alert scan to run daily at 8:00 AM Myanmar time (UTC+6:30)
-- Scans all branches for low-stock and expiry alerts
SELECT cron.schedule(
  'daily-alert-scan',
  '30 1 * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.url', true) || '/api/cron/alerts',
      headers := '{"Authorization": "Bearer ' || current_setting('app.cron_secret', true) || '", "Content-Type": "application/json"}'::jsonb
    )
  $$
);

-- Schedule the backup export to run daily at 2:00 AM Myanmar time (UTC+6:30)
SELECT cron.schedule(
  'daily-backup',
  '30 17 * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.url', true) || '/api/admin/backup',
      headers := '{"Authorization": "Bearer ' || current_setting('app.cron_secret', true) || '", "Content-Type": "application/json"}'::jsonb
    )
  $$
);

-- Verify: SELECT jobid, schedule, command, active FROM cron.job;
-- Unschedule: SELECT cron.unschedule('daily-alert-scan');
-- Run now: SELECT cron.run('daily-alert-scan');
-- History: SELECT * FROM cron.job_run_details ORDER BY start_time DESC;
