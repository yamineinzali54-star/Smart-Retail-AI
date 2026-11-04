-- Create a passworded login role alongside the original passwordless role.
-- Run in Neon SQL Editor against the web-app database.
--
-- Before running, replace the password placeholder below with a newly generated
-- 32+ character alphanumeric password. Keep that value private; use it in
-- ai-service/.env only. The old smartretail_ai_reader role is left untouched.

DO $$
DECLARE
  reader_password text := 'REPLACE_WITH_A_NEW_32_PLUS_CHARACTER_PASSWORD';
BEGIN
  IF length(reader_password) < 32 OR reader_password !~ '^[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION
      'Set reader_password to a password of at least 32 alphanumeric characters';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'smartretail_ai_reader_login'
  ) THEN
    RAISE EXCEPTION
      'smartretail_ai_reader_login already exists; do not rerun role creation with a different password';
  END IF;

  EXECUTE format(
    'CREATE ROLE smartretail_ai_reader_login WITH LOGIN PASSWORD %L NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5',
    reader_password
  );
END
$$;

DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO smartretail_ai_reader_login', current_database()
  );
END
$$;

GRANT USAGE ON SCHEMA public TO smartretail_ai_reader_login;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO smartretail_ai_reader_login;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM smartretail_ai_reader_login;
REVOKE USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA public FROM smartretail_ai_reader_login;

-- Existing RLS policies grant SELECT to this NOLOGIN role. Allow inherited
-- policy membership, but disallow SET ROLE into `authenticated` (PostgreSQL 16+).
-- Restrict role switching; the reader must never assume authenticated's
-- INSERT/UPDATE/DELETE privileges.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'
  ) THEN
    EXECUTE 'GRANT authenticated TO smartretail_ai_reader_login WITH INHERIT TRUE, SET FALSE';
  END IF;
END
$$;

-- Run as the role that creates app tables so future tables remain readable.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO smartretail_ai_reader_login;
