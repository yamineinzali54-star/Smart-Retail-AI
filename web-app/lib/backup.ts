import "server-only";

import { db } from "@/db";
import * as schema from "@/db/schema";

// Backup table registry — SINGLE source of truth for export + restore.
// Keys are REAL SQL table names (what `INSERT INTO` needs); values are the
// drizzle table objects. Covers every schema table — the old export route
// only had 37 (every Batch 1/2/5 table was silently missing) and the old
// restore used drizzle var names as SQL names, so it targeted tables that
// don't exist (e.g. INSERT INTO authSessions vs auth_session).
export const BACKUP_TABLES = {
  branch: schema.branches,
  app_setting: schema.appSettings,
  auth_session: schema.authSessions,
  permission: schema.permissions,
  audit_log: schema.auditLogs,
  users: schema.users,
  category: schema.categories,
  unit: schema.units,
  products: schema.products,
  product_uom_conversion: schema.productUomConversions,
  suppliers: schema.suppliers,
  supplier_product: schema.supplierProducts,
  counter: schema.counters,
  purchase_order: schema.purchaseOrders,
  po_detail: schema.poDetails,
  grn: schema.grns,
  items: schema.items,
  pos_session: schema.posSessions,
  sale: schema.sales,
  sale_detail: schema.saleDetails,
  cart: schema.carts,
  cart_item: schema.cartItems,
  sale_return: schema.saleReturns,
  sale_return_detail: schema.saleReturnDetails,
  supplier_payment: schema.supplierPayments,
  supplier_return: schema.supplierReturns,
  supplier_return_detail: schema.supplierReturnDetails,
  product_price_history: schema.productPriceHistory,
  stock_transfer: schema.stockTransfers,
  stock_transfer_detail: schema.stockTransferDetails,
  ground_balance: schema.groundBalances,
  ground_balance_detail: schema.groundBalanceDetails,
  stock_adjustment: schema.stockAdjustments,
  stock_adjustment_detail: schema.stockAdjustmentDetails,
  expense_category: schema.expenseCategories,
  expense: schema.expenses,
  expense_budget: schema.expenseBudgets,
  roster_schedule: schema.rosterSchedules,
  roster_schedule_entry: schema.rosterScheduleEntries,
  shift_roster: schema.shiftRosters,
  staff_attendance: schema.staffAttendance,
  promotion: schema.promotions,
  promotion_product: schema.promotionProducts,
  notification: schema.notifications,
  notification_subscription: schema.notificationSubscriptions,
  gl_account: schema.glAccounts,
  journal_entry: schema.journalEntries,
  journal_line: schema.journalLines,
  petty_cash_float: schema.pettyCashFloats,
  shift_handover: schema.shiftHandovers,
  user_branch: schema.userBranches,
  ai_api_key: schema.aiApiKeys,
  ai_model: schema.aiModels,
  ai_chat_conversation: schema.aiChatConversations,
  ai_chat_message: schema.aiChatMessages,
} as const;

// Restore order: parents before children (FK-safe even though restore runs
// with session_replication_role='replica').
export const RESTORE_ORDER: Array<keyof typeof BACKUP_TABLES> = [
  "branch",
  "app_setting",
  "users",
  "user_branch",
  "ai_api_key",
  "ai_model",
  "ai_chat_conversation",
  "ai_chat_message",
  "category",
  "unit",
  "products",
  "product_uom_conversion",
  "suppliers",
  "supplier_product",
  "counter",
  "gl_account",
  "expense_category",
  "purchase_order",
  "po_detail",
  "grn",
  "items",
  "product_price_history",
  "pos_session",
  "roster_schedule",
  "roster_schedule_entry",
  "shift_roster",
  "staff_attendance",
  "shift_handover",
  "sale",
  "sale_detail",
  "cart",
  "cart_item",
  "sale_return",
  "sale_return_detail",
  "supplier_payment",
  "supplier_return",
  "supplier_return_detail",
  "stock_transfer",
  "stock_transfer_detail",
  "ground_balance",
  "ground_balance_detail",
  "stock_adjustment",
  "stock_adjustment_detail",
  "expense",
  "expense_budget",
  "petty_cash_float",
  "promotion",
  "promotion_product",
  "journal_entry",
  "journal_line",
  "notification",
  "notification_subscription",
  "permission",
  "auth_session",
  "audit_log",
];

export interface BackupPayload {
  exportedAt: string;
  tableCount: number;
  rowCount: number;
  tables: Record<string, unknown[]>;
}

export async function exportBackup(): Promise<BackupPayload> {
  const tables: Record<string, unknown[]> = {};
  let rowCount = 0;
  for (const [name, table] of Object.entries(BACKUP_TABLES)) {
    const rows = (await db.select().from(table as never)) as unknown[];
    tables[name] = rows;
    rowCount += rows.length;
  }
  return {
    exportedAt: new Date().toISOString(),
    tableCount: Object.keys(BACKUP_TABLES).length,
    rowCount,
    tables,
  };
}
