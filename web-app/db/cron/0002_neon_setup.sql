-- pg_cron on NEON (companion to 0001_setup.sql, which is NOT for Neon).
--
-- ⚠️  VERIFIED BLOCKER (2026-10-06, this Neon project): the `postgres`
-- database is owned by `cloud_admin` (Neon-internal, no user access) and
-- `neondb_owner` is NOT superuser — CREATE EXTENSION / CREATE PROCEDURE in
-- `postgres` both fail with permission denied. pg_cron is therefore
-- UNAVAILABLE on this Neon project. This file is kept for reference for
-- Neon projects where the owner role DOES have CREATE on `postgres`.
-- For THIS project use the external HTTP cron instead:
--   GET /api/cron/alerts with `Authorization: Bearer <CRON_SECRET>`
--   (Windows Task Scheduler, Vercel Cron, or GitHub Actions schedule).
--
-- WHY THIS FILE EXISTS: Neon locks `cron.database_name = 'postgres'`, so
-- pg_cron can only be installed and scheduled in the `postgres` database —
-- never in `neondb`. Jobs therefore run in `postgres` and reach the app data
-- via dblink. pg_net / ALTER SYSTEM / same-DB scheduling (0001) do NOT work
-- on Neon, which is why this file exists separately.
--
-- HOW TO RUN (psql, placeholders replaced):
--   1. Build a DIRECT (non-pooler) connection string to the `postgres` DB:
--      take DATABASE_URL, drop `-pooler` from the host, change dbname to
--      `postgres`:
--        postgresql://neondb_owner:__PASSWORD__@ep-xxxx.c-3.ap-southeast-1.aws.neon.tech/postgres?sslmode=require
--   2. psql "<that-string>" -v neondb_host="'ep-xxxx.c-3...aws.neon.tech'" \
--        -v neondb_password="'__PASSWORD__'" -f db/cron/0002_neon_setup.sql
--      (psql -v values arrive quoted; keep the single quotes inside.)
--   3. Verify: SELECT jobid, jobname, schedule, active FROM cron.job;
--
-- SECURITY: the neondb password lives inside the procedure body / dblink
-- connection string, readable by anyone who can read the `postgres` database.
-- Acceptable for single-owner Neon projects; rotate if the team grows.

-- Extensions (postgres DB only — fails in neondb by Neon design).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS dblink;

-- Scan procedure: mirrors app/api/cron/alerts/route.ts logic —
-- per branch: low-stock count (stock <= reorder_threshold, default 5),
-- expired + expiring-within-30d counts (stock > 0), with today-dedupe
-- (skip type if an unread notification of that type was created today).
CREATE OR REPLACE PROCEDURE public.neondb_alert_scan()
LANGUAGE plpgsql
AS $$
DECLARE
  connstr TEXT :=
    'host=' || :'neondb_host' ||
    ' dbname=neondb user=neondb_owner password=' || :'neondb_password' ||
    ' sslmode=require';
  conn TEXT;
  br RECORD;
  low_ct BIGINT;
  exp_ct BIGINT;
  soon_ct BIGINT;
  have_low INT;
  have_exp INT;
BEGIN
  SELECT dblink_connect(connstr) INTO conn;

  FOR br IN
    SELECT * FROM dblink(conn, 'SELECT id::text, code FROM branch')
      AS b(id TEXT, code TEXT)
  LOOP
    -- Low-stock batches.
    SELECT c INTO low_ct FROM dblink(conn, format(
      'SELECT count(*) FROM items i JOIN products p ON p.id = i.product_id ' ||
      'WHERE i.branch_id = %L AND COALESCE(i.current_stock_quantity,0) > 0 ' ||
      'AND COALESCE(i.current_stock_quantity,0) <= COALESCE(p.reorder_threshold,5)',
      br.id)) AS t(c BIGINT);

    -- Expired (stock > 0).
    SELECT c INTO exp_ct FROM dblink(conn, format(
      'SELECT count(*) FROM items ' ||
      'WHERE branch_id = %L AND expiry_date IS NOT NULL ' ||
      'AND expiry_date < CURRENT_DATE AND COALESCE(current_stock_quantity,0) > 0',
      br.id)) AS t(c BIGINT);

    -- Expiring within 30 days (stock > 0, not yet expired).
    SELECT c INTO soon_ct FROM dblink(conn, format(
      'SELECT count(*) FROM items ' ||
      'WHERE branch_id = %L AND expiry_date IS NOT NULL ' ||
      'AND expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + 30 ' ||
      'AND COALESCE(current_stock_quantity,0) > 0',
      br.id)) AS t(c BIGINT);

    -- Today-dedupe flags.
    SELECT c INTO have_low FROM dblink(conn, format(
      'SELECT count(*) FROM notification ' ||
      'WHERE branch_id = %L AND type = ''low_stock'' AND is_read = false ' ||
      'AND created_at >= CURRENT_DATE',
      br.id)) AS t(c INT);
    SELECT c INTO have_exp FROM dblink(conn, format(
      'SELECT count(*) FROM notification ' ||
      'WHERE branch_id = %L AND type = ''expiry'' AND is_read = false ' ||
      'AND created_at >= CURRENT_DATE',
      br.id)) AS t(c INT);

    IF low_ct > 0 AND have_low = 0 THEN
      PERFORM dblink_exec(conn, format(
        'INSERT INTO notification (branch_id, user_id, type, title, message, channel) ' ||
        'VALUES (%L, NULL, ''low_stock'', ''Low stock alert'', %L, ''in_app'')',
        br.id,
        low_ct || ' batch(es) at or below reorder threshold. (via pg_cron)'));
    END IF;

    IF (exp_ct > 0 OR soon_ct > 0) AND have_exp = 0 THEN
      PERFORM dblink_exec(conn, format(
        'INSERT INTO notification (branch_id, user_id, type, title, message, channel) ' ||
        'VALUES (%L, NULL, ''expiry'', ''Expiry alert'', %L, ''in_app'')',
        br.id,
        exp_ct || ' expired, ' || soon_ct || ' expiring within 30 days (stock > 0). (via pg_cron)'));
    END IF;
  END LOOP;

  PERFORM dblink_disconnect(conn);
EXCEPTION WHEN OTHERS THEN
  BEGIN PERFORM dblink_disconnect(conn); EXCEPTION WHEN OTHERS THEN NULL; END;
  RAISE;
END;
$$;

-- Daily at 8:00 AM Myanmar time (UTC+6:30) = 01:30 UTC.
-- Idempotent: drop the old schedule first if it exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'neondb-daily-alert-scan') THEN
    PERFORM cron.unschedule('neondb-daily-alert-scan');
  END IF;
END;
$$;
SELECT cron.schedule(
  'neondb-daily-alert-scan',
  '30 1 * * *',
  'CALL public.neondb_alert_scan()'
);

-- Verify:  SELECT jobid, jobname, schedule, command, active FROM cron.job;
-- Run now:  SELECT cron.run('neondb-daily-alert-scan');
-- History:  SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- Remove:   SELECT cron.unschedule('neondb-daily-alert-scan');
