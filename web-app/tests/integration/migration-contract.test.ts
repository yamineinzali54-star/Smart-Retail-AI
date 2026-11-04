// Database harness: migration/source contract.
// Fails the suite when db/schema.ts drifts from the migrated database
// (missing table/column/index). Read-only — safe on any environment.
import "../env";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";

interface ColumnRow {
  table_name: string;
  column_name: string;
}

// Every table the app code touches, with the columns contracts depend on.
// Mirrors PROJECT_PLAN.md §3 (fixes + ERP extensions).
const EXPECTED: Record<string, string[]> = {
  branch: ["id", "code", "name", "cash_discrepancy_threshold", "rounding_unit"],
  users: ["id", "branch_id", "user_name", "password_hash", "full_name", "role", "is_active", "totp_secret", "totp_verified"],
  permission: ["id", "role", "action_key", "is_allowed"],
  audit_log: ["id", "entity_type", "entity_id", "action", "description", "old_values", "new_values", "user_id", "branch_id", "ip_address"],
  category: ["id", "branch_id", "name", "short_name", "tax_rate", "is_tax_exempt", "is_deleted"],
  unit: ["id", "branch_id", "name", "short_name", "is_deleted"],
  products: ["id", "branch_id", "category_id", "unit_id", "name", "reorder_threshold", "is_deleted"],
  product_uom_conversion: ["id", "product_id", "purchase_unit_id", "sale_unit_id", "conversion_factor"],
  suppliers: ["id", "branch_id", "name", "is_deleted"],
  supplier_product: ["supplier_id", "product_id"],
  customers: ["id", "branch_id", "name", "credit_limit", "is_deleted"],
  counter: ["id", "branch_id", "name", "is_active", "is_deleted"],
  purchase_order: ["id", "branch_id", "po_number", "supplier_id", "status", "payment_status", "total_amount"],
  po_detail: ["id", "po_id", "product_id", "quantity", "unit_price"],
  grn: ["id", "branch_id", "grn_number", "po_id"],
  items: ["id", "branch_id", "product_id", "grn_id", "barcode", "received_quantity", "current_stock_quantity", "purchase_price", "selling_price", "expiry_date"],
  pos_session: ["id", "user_id", "counter_id", "branch_id", "status", "opening_cash", "expected_closing_cash", "actual_closing_cash", "cash_difference"],
  sale: ["id", "branch_id", "sale_number", "pos_session_id", "payment_method", "status", "rounding_adjustment", "grand_total"],
  sale_detail: ["id", "sale_id", "item_id", "product_id", "quantity", "tax_rate_applied"],
  cart: ["id", "pos_session_id"],
  cart_item: ["id", "cart_id", "product_id", "item_id", "quantity"],
  sale_return: ["id", "branch_id", "return_number", "sale_id", "status"],
  sale_return_detail: ["id", "return_id", "sale_detail_id", "item_id", "quantity"],
  supplier_payment: ["id", "branch_id", "supplier_id", "po_id", "amount", "method"],
  customer_ledger: ["id", "branch_id", "customer_id", "sale_id", "type", "amount", "balance_after"],
  supplier_return: ["id", "branch_id", "debit_note_number", "supplier_id", "status"],
  supplier_return_detail: ["id", "return_id", "item_id", "quantity", "total_value"],
  product_price_history: ["id", "product_id", "old_price", "new_price"],
  stock_transfer: ["id", "transfer_number", "from_branch_id", "to_branch_id", "status"],
  stock_transfer_detail: ["id", "transfer_id", "item_id", "quantity"],
  ground_balance: ["batch_no", "branch_id", "gb_date", "status"],
  ground_balance_detail: ["id", "batch_no", "item_id", "actual_qty", "inventory_qty", "difference_qty"],
  promotion: ["id", "branch_id", "name", "type", "status", "is_ai_suggested"],
  promotion_product: ["id", "promotion_id", "product_id"],
  notification: ["id", "branch_id", "user_id", "type", "channel", "is_read"],
  notification_subscription: ["id", "user_id", "telegram_chat_id", "is_enabled"],
  auth_session: ["id", "user_id", "refresh_token_hash", "expires_at", "revoked_at"],
  app_setting: ["key", "value"],
};

async function rawRows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as
    | T[]
    | { rows: T[] };
  return Array.isArray(result) ? result : result.rows;
}

async function actualColumns(): Promise<Map<string, Set<string>>> {
  const rows = await rawRows<ColumnRow>(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.table_name)) map.set(r.table_name, new Set());
    map.get(r.table_name)!.add(r.column_name);
  }
  return map;
}

describe("migration/source contract", () => {
  it("every expected table and column exists in the migrated database", async () => {
    const actual = await actualColumns();
    const missing: string[] = [];
    for (const [table, columns] of Object.entries(EXPECTED)) {
      const have = actual.get(table);
      if (!have) {
        missing.push(`table ${table}`);
        continue;
      }
      for (const col of columns) {
        if (!have.has(col)) missing.push(`${table}.${col}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("enforces the §16 branch rule: transactional tables carry branch_id", async () => {
    const actual = await actualColumns();
    const branchScoped = [
      "users", "category", "unit", "products", "suppliers", "customers",
      "counter", "purchase_order", "grn", "items", "pos_session", "sale",
      "sale_return", "supplier_payment", "customer_ledger", "supplier_return",
      "promotion", "ground_balance",
    ];
    const missing = branchScoped.filter(
      (t) => !actual.get(t)?.has("branch_id"),
    );
    expect(missing).toEqual([]);
  });

  it("keeps security-critical unique constraints", async () => {
    const rows = await rawRows<{ index_name: string }>(sql`
      SELECT c.relname AS index_name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indisunique
    `);
    const names = new Set(rows.map((r) => r.index_name));
    // Unique indexes created for these constraints (drizzle naming may vary,
    // so match by suffix convention used in schema.ts).
    for (const expected of [
      "users_user_name_unique",
      "items_barcode_unique",
      "permission_role_action_key_uniq",
    ]) {
      expect(names.has(expected)).toBe(true);
    }
  });
});
