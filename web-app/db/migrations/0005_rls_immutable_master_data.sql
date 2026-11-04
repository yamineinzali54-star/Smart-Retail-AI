
-- RLS: Immutable master data protection (PROJECT_PLAN.md §10)
-- Audit logs: INSERT-only for app role; no UPDATE/DELETE.
-- Master data (categories, units, products, suppliers): soft-delete only; no hard DELETE.

-- ============================================================================
-- AUDIT_LOG: append-only
-- ============================================================================
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Re-create policies idempotently
DROP POLICY IF EXISTS audit_log_insert ON audit_log;
DROP POLICY IF EXISTS audit_log_select ON audit_log;
DROP POLICY IF EXISTS audit_log_update ON audit_log;
DROP POLICY IF EXISTS audit_log_delete ON audit_log;

CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY audit_log_select ON audit_log
  FOR SELECT TO authenticated
  USING (true);

-- Explicit deny: no update, no delete (immutability)
CREATE POLICY audit_log_update ON audit_log
  FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY audit_log_delete ON audit_log
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- CATEGORIES: no hard delete (soft-delete via is_deleted flag)
-- ============================================================================
ALTER TABLE category ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categories_no_hard_delete ON category;
CREATE POLICY categories_no_hard_delete ON category
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- UNITS: no hard delete
-- ============================================================================
ALTER TABLE unit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS units_no_hard_delete ON unit;
CREATE POLICY units_no_hard_delete ON unit
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- PRODUCTS: no hard delete
-- ============================================================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_no_hard_delete ON products;
CREATE POLICY products_no_hard_delete ON products
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- SUPPLIERS: no hard delete
-- ============================================================================
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_no_hard_delete ON suppliers;
CREATE POLICY suppliers_no_hard_delete ON suppliers
  FOR DELETE TO authenticated
  USING (false);

