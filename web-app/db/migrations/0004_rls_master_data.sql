
-- RLS: Immutable master data (Categories, Units, Products, Suppliers, Branches)
-- Only admins (validated via secure function) may INSERT/UPDATE/DELETE.
-- All authenticated users may SELECT (active rows).

-- NOTE: this file is NOT in drizzle's _journal.json — apply manually AFTER
-- `npm run db:migrate`, in numeric order:
--   psql "$DATABASE_URL" -f db/migrations/0004_rls_master_data.sql
-- (Same convention as 0005_rls_immutable_master_data.sql and
-- 0015_rls_remaining_tables.sql.)

-- ============================================================================
-- Prerequisites for plain-Neon Postgres (no Supabase `authenticated` role or
-- `auth.jwt()`). Idempotent — safe to run once per database; 0015 repeats it.
-- The app connects as table owner (bypasses RLS); these policies protect
-- direct non-owner access (psql, BI tools) only.
-- ============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;

-- ============================================================================
-- Helper: check if the current JWT-holder is an admin
-- (runs as SECURITY DEFINER so the JWT secret stays out of user reach)
-- ============================================================================
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = (auth.jwt() ->> 'sub')::uuid
      AND u.role = 'admin'
      AND u.is_active = true
  )
$$;

-- ============================================================================
-- CATEGORIES
-- ============================================================================
ALTER TABLE category ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categories_select ON category;
DROP POLICY IF EXISTS categories_insert ON category;
DROP POLICY IF EXISTS categories_update ON category;
DROP POLICY IF EXISTS categories_delete ON category;

CREATE POLICY categories_select ON category
  FOR SELECT TO authenticated
  USING (is_deleted = false);

CREATE POLICY categories_insert ON category
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY categories_update ON category
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY categories_delete ON category
  FOR DELETE TO authenticated
  USING (is_admin());

-- ============================================================================
-- UNITS
-- ============================================================================
ALTER TABLE unit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS units_select ON unit;
DROP POLICY IF EXISTS units_insert ON unit;
DROP POLICY IF EXISTS units_update ON unit;
DROP POLICY IF EXISTS units_delete ON unit;

CREATE POLICY units_select ON unit
  FOR SELECT TO authenticated
  USING (is_deleted = false);

CREATE POLICY units_insert ON unit
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY units_update ON unit
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY units_delete ON unit
  FOR DELETE TO authenticated
  USING (is_admin());

-- ============================================================================
-- PRODUCTS
-- ============================================================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_select ON products;
DROP POLICY IF EXISTS products_insert ON products;
DROP POLICY IF EXISTS products_update ON products;
DROP POLICY IF EXISTS products_delete ON products;

CREATE POLICY products_select ON products
  FOR SELECT TO authenticated
  USING (is_deleted = false);

CREATE POLICY products_insert ON products
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY products_update ON products
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY products_delete ON products
  FOR DELETE TO authenticated
  USING (is_admin());

-- ============================================================================
-- SUPPLIERS
-- ============================================================================
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_select ON suppliers;
DROP POLICY IF EXISTS suppliers_insert ON suppliers;
DROP POLICY IF EXISTS suppliers_update ON suppliers;
DROP POLICY IF EXISTS suppliers_delete ON suppliers;

CREATE POLICY suppliers_select ON suppliers
  FOR SELECT TO authenticated
  USING (is_deleted = false);

CREATE POLICY suppliers_insert ON suppliers
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY suppliers_update ON suppliers
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY suppliers_delete ON suppliers
  FOR DELETE TO authenticated
  USING (is_admin());

-- ============================================================================
-- BRANCHES (admin-only writes; no soft-delete on branch)
-- ============================================================================
ALTER TABLE branch ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS branch_select ON branch;
DROP POLICY IF EXISTS branch_insert ON branch;
DROP POLICY IF EXISTS branch_update ON branch;
DROP POLICY IF EXISTS branch_delete ON branch;

CREATE POLICY branch_select ON branch
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY branch_insert ON branch
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY branch_update ON branch
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY branch_delete ON branch
  FOR DELETE TO authenticated
  USING (is_admin());

-- ============================================================================
-- EMPLOYEES (users table): admin-only writes, self/other read controlled
-- ============================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select ON users;
DROP POLICY IF EXISTS users_insert ON users;
DROP POLICY IF EXISTS users_update ON users;
DROP POLICY IF EXISTS users_delete ON users;

CREATE POLICY users_select ON users
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY users_insert ON users
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY users_update ON users
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY users_delete ON users
  FOR DELETE TO authenticated
  USING (is_admin());

