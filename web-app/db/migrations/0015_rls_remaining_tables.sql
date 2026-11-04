-- RLS: remaining tables (extends 0004_rls_master_data.sql + 0005 pattern).
-- Same convention: SELECT for `authenticated`, INSERT/UPDATE/DELETE admin-only
-- via is_admin(). Append-only ledgers get INSERT-only + explicit deny on
-- UPDATE/DELETE (mirrors 0005 audit_log).
--
-- NOT in drizzle's _journal.json — apply manually AFTER `npm run db:migrate`:
--   psql "$DATABASE_URL" -f db/migrations/0004_rls_master_data.sql
--   psql "$DATABASE_URL" -f db/migrations/0005_rls_immutable_master_data.sql
--   psql "$DATABASE_URL" -f db/migrations/0015_rls_remaining_tables.sql
--
-- Truth-in-advertising: the app connects as table owner, so RLS never fires
-- for app traffic (real enforcement = API route guards + PageShell map).
-- These policies protect direct non-owner access (psql, BI tools) only.
-- `auth.jwt()` is a NULL stub on plain Neon, so is_admin() is false for every
-- non-owner connection: reads allowed, writes admin-only, sessions hidden.

-- Prerequisites (idempotent; repeats 0004 header so this file is self-contained).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;

-- ============================================================================
-- AUTH_SESSION: refresh-token hashes — hide from non-admins entirely.
-- (App login/logout runs as owner and bypasses RLS.)
-- ============================================================================
ALTER TABLE auth_session ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_session_select ON auth_session;
DROP POLICY IF EXISTS auth_session_insert ON auth_session;
DROP POLICY IF EXISTS auth_session_update ON auth_session;
DROP POLICY IF EXISTS auth_session_delete ON auth_session;
CREATE POLICY auth_session_select ON auth_session FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY auth_session_insert ON auth_session FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY auth_session_update ON auth_session FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY auth_session_delete ON auth_session FOR DELETE TO authenticated USING (is_admin());

-- ============================================================================
-- Standard tables: SELECT authenticated, writes admin-only.
-- ============================================================================
ALTER TABLE permission ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS permission_select ON permission;
DROP POLICY IF EXISTS permission_write ON permission;
CREATE POLICY permission_select ON permission FOR SELECT TO authenticated USING (true);
CREATE POLICY permission_insert ON permission FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY permission_update ON permission FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY permission_delete ON permission FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE "counter" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS counter_select ON "counter";
DROP POLICY IF EXISTS counter_insert ON "counter";
DROP POLICY IF EXISTS counter_update ON "counter";
DROP POLICY IF EXISTS counter_delete ON "counter";
CREATE POLICY counter_select ON "counter" FOR SELECT TO authenticated USING (true);
CREATE POLICY counter_insert ON "counter" FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY counter_update ON "counter" FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY counter_delete ON "counter" FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customers_select ON customers;
DROP POLICY IF EXISTS customers_insert ON customers;
DROP POLICY IF EXISTS customers_update ON customers;
DROP POLICY IF EXISTS customers_delete ON customers;
CREATE POLICY customers_select ON customers FOR SELECT TO authenticated USING (true);
CREATE POLICY customers_insert ON customers FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY customers_update ON customers FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY customers_delete ON customers FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE purchase_order ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_order_select ON purchase_order;
DROP POLICY IF EXISTS purchase_order_insert ON purchase_order;
DROP POLICY IF EXISTS purchase_order_update ON purchase_order;
DROP POLICY IF EXISTS purchase_order_delete ON purchase_order;
CREATE POLICY purchase_order_select ON purchase_order FOR SELECT TO authenticated USING (true);
CREATE POLICY purchase_order_insert ON purchase_order FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY purchase_order_update ON purchase_order FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY purchase_order_delete ON purchase_order FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE po_detail ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS po_detail_select ON po_detail;
DROP POLICY IF EXISTS po_detail_insert ON po_detail;
DROP POLICY IF EXISTS po_detail_update ON po_detail;
DROP POLICY IF EXISTS po_detail_delete ON po_detail;
CREATE POLICY po_detail_select ON po_detail FOR SELECT TO authenticated USING (true);
CREATE POLICY po_detail_insert ON po_detail FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY po_detail_update ON po_detail FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY po_detail_delete ON po_detail FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE grn ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS grn_select ON grn;
DROP POLICY IF EXISTS grn_insert ON grn;
DROP POLICY IF EXISTS grn_update ON grn;
DROP POLICY IF EXISTS grn_delete ON grn;
CREATE POLICY grn_select ON grn FOR SELECT TO authenticated USING (true);
CREATE POLICY grn_insert ON grn FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY grn_update ON grn FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY grn_delete ON grn FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS items_select ON items;
DROP POLICY IF EXISTS items_insert ON items;
DROP POLICY IF EXISTS items_update ON items;
DROP POLICY IF EXISTS items_delete ON items;
CREATE POLICY items_select ON items FOR SELECT TO authenticated USING (true);
CREATE POLICY items_insert ON items FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY items_update ON items FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY items_delete ON items FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE pos_session ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_session_select ON pos_session;
DROP POLICY IF EXISTS pos_session_insert ON pos_session;
DROP POLICY IF EXISTS pos_session_update ON pos_session;
DROP POLICY IF EXISTS pos_session_delete ON pos_session;
CREATE POLICY pos_session_select ON pos_session FOR SELECT TO authenticated USING (true);
CREATE POLICY pos_session_insert ON pos_session FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY pos_session_update ON pos_session FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY pos_session_delete ON pos_session FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE sale ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_select ON sale;
DROP POLICY IF EXISTS sale_insert ON sale;
DROP POLICY IF EXISTS sale_update ON sale;
DROP POLICY IF EXISTS sale_delete ON sale;
CREATE POLICY sale_select ON sale FOR SELECT TO authenticated USING (true);
CREATE POLICY sale_insert ON sale FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY sale_update ON sale FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY sale_delete ON sale FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE sale_detail ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_detail_select ON sale_detail;
DROP POLICY IF EXISTS sale_detail_insert ON sale_detail;
DROP POLICY IF EXISTS sale_detail_update ON sale_detail;
DROP POLICY IF EXISTS sale_detail_delete ON sale_detail;
CREATE POLICY sale_detail_select ON sale_detail FOR SELECT TO authenticated USING (true);
CREATE POLICY sale_detail_insert ON sale_detail FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY sale_detail_update ON sale_detail FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY sale_detail_delete ON sale_detail FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE cart ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cart_select ON cart;
DROP POLICY IF EXISTS cart_insert ON cart;
DROP POLICY IF EXISTS cart_update ON cart;
DROP POLICY IF EXISTS cart_delete ON cart;
CREATE POLICY cart_select ON cart FOR SELECT TO authenticated USING (true);
CREATE POLICY cart_insert ON cart FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY cart_update ON cart FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY cart_delete ON cart FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE cart_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cart_item_select ON cart_item;
DROP POLICY IF EXISTS cart_item_insert ON cart_item;
DROP POLICY IF EXISTS cart_item_update ON cart_item;
DROP POLICY IF EXISTS cart_item_delete ON cart_item;
CREATE POLICY cart_item_select ON cart_item FOR SELECT TO authenticated USING (true);
CREATE POLICY cart_item_insert ON cart_item FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY cart_item_update ON cart_item FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY cart_item_delete ON cart_item FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE sale_return ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_return_select ON sale_return;
DROP POLICY IF EXISTS sale_return_insert ON sale_return;
DROP POLICY IF EXISTS sale_return_update ON sale_return;
DROP POLICY IF EXISTS sale_return_delete ON sale_return;
CREATE POLICY sale_return_select ON sale_return FOR SELECT TO authenticated USING (true);
CREATE POLICY sale_return_insert ON sale_return FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY sale_return_update ON sale_return FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY sale_return_delete ON sale_return FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE sale_return_detail ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_return_detail_select ON sale_return_detail;
DROP POLICY IF EXISTS sale_return_detail_insert ON sale_return_detail;
DROP POLICY IF EXISTS sale_return_detail_update ON sale_return_detail;
DROP POLICY IF EXISTS sale_return_detail_delete ON sale_return_detail;
CREATE POLICY sale_return_detail_select ON sale_return_detail FOR SELECT TO authenticated USING (true);
CREATE POLICY sale_return_detail_insert ON sale_return_detail FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY sale_return_detail_update ON sale_return_detail FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY sale_return_detail_delete ON sale_return_detail FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE supplier_payment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_payment_select ON supplier_payment;
DROP POLICY IF EXISTS supplier_payment_insert ON supplier_payment;
DROP POLICY IF EXISTS supplier_payment_update ON supplier_payment;
DROP POLICY IF EXISTS supplier_payment_delete ON supplier_payment;
CREATE POLICY supplier_payment_select ON supplier_payment FOR SELECT TO authenticated USING (true);
CREATE POLICY supplier_payment_insert ON supplier_payment FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY supplier_payment_update ON supplier_payment FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY supplier_payment_delete ON supplier_payment FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE supplier_return ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_return_select ON supplier_return;
DROP POLICY IF EXISTS supplier_return_insert ON supplier_return;
DROP POLICY IF EXISTS supplier_return_update ON supplier_return;
DROP POLICY IF EXISTS supplier_return_delete ON supplier_return;
CREATE POLICY supplier_return_select ON supplier_return FOR SELECT TO authenticated USING (true);
CREATE POLICY supplier_return_insert ON supplier_return FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY supplier_return_update ON supplier_return FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY supplier_return_delete ON supplier_return FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE supplier_return_detail ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_return_detail_select ON supplier_return_detail;
DROP POLICY IF EXISTS supplier_return_detail_insert ON supplier_return_detail;
DROP POLICY IF EXISTS supplier_return_detail_update ON supplier_return_detail;
DROP POLICY IF EXISTS supplier_return_detail_delete ON supplier_return_detail;
CREATE POLICY supplier_return_detail_select ON supplier_return_detail FOR SELECT TO authenticated USING (true);
CREATE POLICY supplier_return_detail_insert ON supplier_return_detail FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY supplier_return_detail_update ON supplier_return_detail FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY supplier_return_detail_delete ON supplier_return_detail FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE stock_transfer ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_transfer_select ON stock_transfer;
DROP POLICY IF EXISTS stock_transfer_insert ON stock_transfer;
DROP POLICY IF EXISTS stock_transfer_update ON stock_transfer;
DROP POLICY IF EXISTS stock_transfer_delete ON stock_transfer;
CREATE POLICY stock_transfer_select ON stock_transfer FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_transfer_insert ON stock_transfer FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY stock_transfer_update ON stock_transfer FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY stock_transfer_delete ON stock_transfer FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE stock_transfer_detail ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_transfer_detail_select ON stock_transfer_detail;
DROP POLICY IF EXISTS stock_transfer_detail_insert ON stock_transfer_detail;
DROP POLICY IF EXISTS stock_transfer_detail_update ON stock_transfer_detail;
DROP POLICY IF EXISTS stock_transfer_detail_delete ON stock_transfer_detail;
CREATE POLICY stock_transfer_detail_select ON stock_transfer_detail FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_transfer_detail_insert ON stock_transfer_detail FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY stock_transfer_detail_update ON stock_transfer_detail FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY stock_transfer_detail_delete ON stock_transfer_detail FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE ground_balance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ground_balance_select ON ground_balance;
DROP POLICY IF EXISTS ground_balance_insert ON ground_balance;
DROP POLICY IF EXISTS ground_balance_update ON ground_balance;
DROP POLICY IF EXISTS ground_balance_delete ON ground_balance;
CREATE POLICY ground_balance_select ON ground_balance FOR SELECT TO authenticated USING (true);
CREATE POLICY ground_balance_insert ON ground_balance FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY ground_balance_update ON ground_balance FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY ground_balance_delete ON ground_balance FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE ground_balance_detail ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ground_balance_detail_select ON ground_balance_detail;
DROP POLICY IF EXISTS ground_balance_detail_insert ON ground_balance_detail;
DROP POLICY IF EXISTS ground_balance_detail_update ON ground_balance_detail;
DROP POLICY IF EXISTS ground_balance_detail_delete ON ground_balance_detail;
CREATE POLICY ground_balance_detail_select ON ground_balance_detail FOR SELECT TO authenticated USING (true);
CREATE POLICY ground_balance_detail_insert ON ground_balance_detail FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY ground_balance_detail_update ON ground_balance_detail FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY ground_balance_detail_delete ON ground_balance_detail FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE stock_adjustment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_adjustment_select ON stock_adjustment;
DROP POLICY IF EXISTS stock_adjustment_insert ON stock_adjustment;
DROP POLICY IF EXISTS stock_adjustment_update ON stock_adjustment;
DROP POLICY IF EXISTS stock_adjustment_delete ON stock_adjustment;
CREATE POLICY stock_adjustment_select ON stock_adjustment FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_adjustment_insert ON stock_adjustment FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY stock_adjustment_update ON stock_adjustment FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY stock_adjustment_delete ON stock_adjustment FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE stock_adjustment_detail ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_adjustment_detail_select ON stock_adjustment_detail;
DROP POLICY IF EXISTS stock_adjustment_detail_insert ON stock_adjustment_detail;
DROP POLICY IF EXISTS stock_adjustment_detail_update ON stock_adjustment_detail;
DROP POLICY IF EXISTS stock_adjustment_detail_delete ON stock_adjustment_detail;
CREATE POLICY stock_adjustment_detail_select ON stock_adjustment_detail FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_adjustment_detail_insert ON stock_adjustment_detail FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY stock_adjustment_detail_update ON stock_adjustment_detail FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY stock_adjustment_detail_delete ON stock_adjustment_detail FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE expense_category ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_category_select ON expense_category;
DROP POLICY IF EXISTS expense_category_insert ON expense_category;
DROP POLICY IF EXISTS expense_category_update ON expense_category;
DROP POLICY IF EXISTS expense_category_delete ON expense_category;
CREATE POLICY expense_category_select ON expense_category FOR SELECT TO authenticated USING (true);
CREATE POLICY expense_category_insert ON expense_category FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY expense_category_update ON expense_category FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY expense_category_delete ON expense_category FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE expense ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_select ON expense;
DROP POLICY IF EXISTS expense_insert ON expense;
DROP POLICY IF EXISTS expense_update ON expense;
DROP POLICY IF EXISTS expense_delete ON expense;
CREATE POLICY expense_select ON expense FOR SELECT TO authenticated USING (true);
CREATE POLICY expense_insert ON expense FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY expense_update ON expense FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY expense_delete ON expense FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE promotion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promotion_select ON promotion;
DROP POLICY IF EXISTS promotion_insert ON promotion;
DROP POLICY IF EXISTS promotion_update ON promotion;
DROP POLICY IF EXISTS promotion_delete ON promotion;
CREATE POLICY promotion_select ON promotion FOR SELECT TO authenticated USING (true);
CREATE POLICY promotion_insert ON promotion FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY promotion_update ON promotion FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY promotion_delete ON promotion FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE promotion_product ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promotion_product_select ON promotion_product;
DROP POLICY IF EXISTS promotion_product_insert ON promotion_product;
DROP POLICY IF EXISTS promotion_product_update ON promotion_product;
DROP POLICY IF EXISTS promotion_product_delete ON promotion_product;
CREATE POLICY promotion_product_select ON promotion_product FOR SELECT TO authenticated USING (true);
CREATE POLICY promotion_product_insert ON promotion_product FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY promotion_product_update ON promotion_product FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY promotion_product_delete ON promotion_product FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_select ON notification;
DROP POLICY IF EXISTS notification_insert ON notification;
DROP POLICY IF EXISTS notification_update ON notification;
DROP POLICY IF EXISTS notification_delete ON notification;
CREATE POLICY notification_select ON notification FOR SELECT TO authenticated USING (true);
CREATE POLICY notification_insert ON notification FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY notification_update ON notification FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY notification_delete ON notification FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE expense_budget ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_budget_select ON expense_budget;
DROP POLICY IF EXISTS expense_budget_insert ON expense_budget;
DROP POLICY IF EXISTS expense_budget_update ON expense_budget;
DROP POLICY IF EXISTS expense_budget_delete ON expense_budget;
CREATE POLICY expense_budget_select ON expense_budget FOR SELECT TO authenticated USING (true);
CREATE POLICY expense_budget_insert ON expense_budget FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY expense_budget_update ON expense_budget FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY expense_budget_delete ON expense_budget FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE shift_roster ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shift_roster_select ON shift_roster;
DROP POLICY IF EXISTS shift_roster_insert ON shift_roster;
DROP POLICY IF EXISTS shift_roster_update ON shift_roster;
DROP POLICY IF EXISTS shift_roster_delete ON shift_roster;
CREATE POLICY shift_roster_select ON shift_roster FOR SELECT TO authenticated USING (true);
CREATE POLICY shift_roster_insert ON shift_roster FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY shift_roster_update ON shift_roster FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY shift_roster_delete ON shift_roster FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE notification_subscription ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_subscription_select ON notification_subscription;
DROP POLICY IF EXISTS notification_subscription_insert ON notification_subscription;
DROP POLICY IF EXISTS notification_subscription_update ON notification_subscription;
DROP POLICY IF EXISTS notification_subscription_delete ON notification_subscription;
CREATE POLICY notification_subscription_select ON notification_subscription FOR SELECT TO authenticated USING (true);
CREATE POLICY notification_subscription_insert ON notification_subscription FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY notification_subscription_update ON notification_subscription FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY notification_subscription_delete ON notification_subscription FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE gift_voucher ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gift_voucher_select ON gift_voucher;
DROP POLICY IF EXISTS gift_voucher_insert ON gift_voucher;
DROP POLICY IF EXISTS gift_voucher_update ON gift_voucher;
DROP POLICY IF EXISTS gift_voucher_delete ON gift_voucher;
CREATE POLICY gift_voucher_select ON gift_voucher FOR SELECT TO authenticated USING (true);
CREATE POLICY gift_voucher_insert ON gift_voucher FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY gift_voucher_update ON gift_voucher FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY gift_voucher_delete ON gift_voucher FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE gift_voucher_redemption ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gift_voucher_redemption_select ON gift_voucher_redemption;
DROP POLICY IF EXISTS gift_voucher_redemption_insert ON gift_voucher_redemption;
DROP POLICY IF EXISTS gift_voucher_redemption_update ON gift_voucher_redemption;
DROP POLICY IF EXISTS gift_voucher_redemption_delete ON gift_voucher_redemption;
CREATE POLICY gift_voucher_redemption_select ON gift_voucher_redemption FOR SELECT TO authenticated USING (true);
CREATE POLICY gift_voucher_redemption_insert ON gift_voucher_redemption FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY gift_voucher_redemption_update ON gift_voucher_redemption FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY gift_voucher_redemption_delete ON gift_voucher_redemption FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE gl_account ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gl_account_select ON gl_account;
DROP POLICY IF EXISTS gl_account_insert ON gl_account;
DROP POLICY IF EXISTS gl_account_update ON gl_account;
DROP POLICY IF EXISTS gl_account_delete ON gl_account;
CREATE POLICY gl_account_select ON gl_account FOR SELECT TO authenticated USING (true);
CREATE POLICY gl_account_insert ON gl_account FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY gl_account_update ON gl_account FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY gl_account_delete ON gl_account FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE petty_cash_float ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS petty_cash_float_select ON petty_cash_float;
DROP POLICY IF EXISTS petty_cash_float_insert ON petty_cash_float;
DROP POLICY IF EXISTS petty_cash_float_update ON petty_cash_float;
DROP POLICY IF EXISTS petty_cash_float_delete ON petty_cash_float;
CREATE POLICY petty_cash_float_select ON petty_cash_float FOR SELECT TO authenticated USING (true);
CREATE POLICY petty_cash_float_insert ON petty_cash_float FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY petty_cash_float_update ON petty_cash_float FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY petty_cash_float_delete ON petty_cash_float FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE shift_handover ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shift_handover_select ON shift_handover;
DROP POLICY IF EXISTS shift_handover_insert ON shift_handover;
DROP POLICY IF EXISTS shift_handover_update ON shift_handover;
DROP POLICY IF EXISTS shift_handover_delete ON shift_handover;
CREATE POLICY shift_handover_select ON shift_handover FOR SELECT TO authenticated USING (true);
CREATE POLICY shift_handover_insert ON shift_handover FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY shift_handover_update ON shift_handover FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY shift_handover_delete ON shift_handover FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE user_branch ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_branch_select ON user_branch;
DROP POLICY IF EXISTS user_branch_insert ON user_branch;
DROP POLICY IF EXISTS user_branch_update ON user_branch;
DROP POLICY IF EXISTS user_branch_delete ON user_branch;
CREATE POLICY user_branch_select ON user_branch FOR SELECT TO authenticated USING (true);
CREATE POLICY user_branch_insert ON user_branch FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY user_branch_update ON user_branch FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY user_branch_delete ON user_branch FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE installment_plan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS installment_plan_select ON installment_plan;
DROP POLICY IF EXISTS installment_plan_insert ON installment_plan;
DROP POLICY IF EXISTS installment_plan_update ON installment_plan;
DROP POLICY IF EXISTS installment_plan_delete ON installment_plan;
CREATE POLICY installment_plan_select ON installment_plan FOR SELECT TO authenticated USING (true);
CREATE POLICY installment_plan_insert ON installment_plan FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY installment_plan_update ON installment_plan FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY installment_plan_delete ON installment_plan FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE installment_due ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS installment_due_select ON installment_due;
DROP POLICY IF EXISTS installment_due_insert ON installment_due;
DROP POLICY IF EXISTS installment_due_update ON installment_due;
DROP POLICY IF EXISTS installment_due_delete ON installment_due;
CREATE POLICY installment_due_select ON installment_due FOR SELECT TO authenticated USING (true);
CREATE POLICY installment_due_insert ON installment_due FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY installment_due_update ON installment_due FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY installment_due_delete ON installment_due FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE credit_note ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_note_select ON credit_note;
DROP POLICY IF EXISTS credit_note_insert ON credit_note;
DROP POLICY IF EXISTS credit_note_update ON credit_note;
DROP POLICY IF EXISTS credit_note_delete ON credit_note;
CREATE POLICY credit_note_select ON credit_note FOR SELECT TO authenticated USING (true);
CREATE POLICY credit_note_insert ON credit_note FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY credit_note_update ON credit_note FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY credit_note_delete ON credit_note FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE credit_note_application ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_note_application_select ON credit_note_application;
DROP POLICY IF EXISTS credit_note_application_insert ON credit_note_application;
DROP POLICY IF EXISTS credit_note_application_update ON credit_note_application;
DROP POLICY IF EXISTS credit_note_application_delete ON credit_note_application;
CREATE POLICY credit_note_application_select ON credit_note_application FOR SELECT TO authenticated USING (true);
CREATE POLICY credit_note_application_insert ON credit_note_application FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY credit_note_application_update ON credit_note_application FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY credit_note_application_delete ON credit_note_application FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE product_uom_conversion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_uom_conversion_select ON product_uom_conversion;
DROP POLICY IF EXISTS product_uom_conversion_insert ON product_uom_conversion;
DROP POLICY IF EXISTS product_uom_conversion_update ON product_uom_conversion;
DROP POLICY IF EXISTS product_uom_conversion_delete ON product_uom_conversion;
CREATE POLICY product_uom_conversion_select ON product_uom_conversion FOR SELECT TO authenticated USING (true);
CREATE POLICY product_uom_conversion_insert ON product_uom_conversion FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY product_uom_conversion_update ON product_uom_conversion FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY product_uom_conversion_delete ON product_uom_conversion FOR DELETE TO authenticated USING (is_admin());

ALTER TABLE supplier_product ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_product_select ON supplier_product;
DROP POLICY IF EXISTS supplier_product_insert ON supplier_product;
DROP POLICY IF EXISTS supplier_product_update ON supplier_product;
DROP POLICY IF EXISTS supplier_product_delete ON supplier_product;
CREATE POLICY supplier_product_select ON supplier_product FOR SELECT TO authenticated USING (true);
CREATE POLICY supplier_product_insert ON supplier_product FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY supplier_product_update ON supplier_product FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY supplier_product_delete ON supplier_product FOR DELETE TO authenticated USING (is_admin());

-- ============================================================================
-- Append-only ledgers (0005 audit_log pattern): INSERT + SELECT only.
-- GL balance invariant is enforced in app code (lib/gl-math.ts); RLS mirrors
-- the immutability at the database boundary for direct access.
-- ============================================================================
ALTER TABLE journal_entry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS journal_entry_select ON journal_entry;
DROP POLICY IF EXISTS journal_entry_insert ON journal_entry;
DROP POLICY IF EXISTS journal_entry_update ON journal_entry;
DROP POLICY IF EXISTS journal_entry_delete ON journal_entry;
CREATE POLICY journal_entry_select ON journal_entry FOR SELECT TO authenticated USING (true);
CREATE POLICY journal_entry_insert ON journal_entry FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY journal_entry_update ON journal_entry FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY journal_entry_delete ON journal_entry FOR DELETE TO authenticated USING (false);

ALTER TABLE journal_line ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS journal_line_select ON journal_line;
DROP POLICY IF EXISTS journal_line_insert ON journal_line;
DROP POLICY IF EXISTS journal_line_update ON journal_line;
DROP POLICY IF EXISTS journal_line_delete ON journal_line;
CREATE POLICY journal_line_select ON journal_line FOR SELECT TO authenticated USING (true);
CREATE POLICY journal_line_insert ON journal_line FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY journal_line_update ON journal_line FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY journal_line_delete ON journal_line FOR DELETE TO authenticated USING (false);

ALTER TABLE loyalty_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS loyalty_ledger_select ON loyalty_ledger;
DROP POLICY IF EXISTS loyalty_ledger_insert ON loyalty_ledger;
DROP POLICY IF EXISTS loyalty_ledger_update ON loyalty_ledger;
DROP POLICY IF EXISTS loyalty_ledger_delete ON loyalty_ledger;
CREATE POLICY loyalty_ledger_select ON loyalty_ledger FOR SELECT TO authenticated USING (true);
CREATE POLICY loyalty_ledger_insert ON loyalty_ledger FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY loyalty_ledger_update ON loyalty_ledger FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY loyalty_ledger_delete ON loyalty_ledger FOR DELETE TO authenticated USING (false);

ALTER TABLE customer_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_ledger_select ON customer_ledger;
DROP POLICY IF EXISTS customer_ledger_insert ON customer_ledger;
DROP POLICY IF EXISTS customer_ledger_update ON customer_ledger;
DROP POLICY IF EXISTS customer_ledger_delete ON customer_ledger;
CREATE POLICY customer_ledger_select ON customer_ledger FOR SELECT TO authenticated USING (true);
CREATE POLICY customer_ledger_insert ON customer_ledger FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY customer_ledger_update ON customer_ledger FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY customer_ledger_delete ON customer_ledger FOR DELETE TO authenticated USING (false);

ALTER TABLE product_price_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_price_history_select ON product_price_history;
DROP POLICY IF EXISTS product_price_history_insert ON product_price_history;
DROP POLICY IF EXISTS product_price_history_update ON product_price_history;
DROP POLICY IF EXISTS product_price_history_delete ON product_price_history;
CREATE POLICY product_price_history_select ON product_price_history FOR SELECT TO authenticated USING (true);
CREATE POLICY product_price_history_insert ON product_price_history FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY product_price_history_update ON product_price_history FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY product_price_history_delete ON product_price_history FOR DELETE TO authenticated USING (false);

-- ============================================================================
-- APP_SETTING: global runtime flags (Telegram controls). Reads open so
-- health checks/BI can see feature flags; writes admin-only.
-- ============================================================================
ALTER TABLE app_setting ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_setting_select ON app_setting;
DROP POLICY IF EXISTS app_setting_insert ON app_setting;
DROP POLICY IF EXISTS app_setting_update ON app_setting;
DROP POLICY IF EXISTS app_setting_delete ON app_setting;
CREATE POLICY app_setting_select ON app_setting FOR SELECT TO authenticated USING (true);
CREATE POLICY app_setting_insert ON app_setting FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY app_setting_update ON app_setting FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY app_setting_delete ON app_setting FOR DELETE TO authenticated USING (is_admin());
