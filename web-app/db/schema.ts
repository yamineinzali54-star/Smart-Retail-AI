// SmartRetailAI — Phase 0 full schema (PROJECT_PLAN.md §3).
//
// Baseline: the Proposal's 26-entity ERD was not in this repo, so the baseline
// below is reconstructed from every entity referenced by PROJECT_PLAN.md
// §§3–7 (tables, flows, endpoints). Assumptions are marked [ASSUMED].
//
// Rules applied throughout:
// - §16: every table carries branch_id EXCEPT genuinely global ones
//   (permission role-defaults, audit_log). Single seed branch in Step 4.
// - §3.1: soft-delete (is_deleted) on all master data, never hard-delete.
// - §4 R24: timestamptz (UTC) everywhere; §4 R25: numeric(12,2) for money.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const roleEnum = pgEnum("role", ["admin", "inventory", "cashier"]);

export const poStatusEnum = pgEnum("po_status", [
  "pending",
  "partially_received",
  "received",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "unpaid",
  "partial",
  "paid",
]);

export const saleStatusEnum = pgEnum("sale_status", [
  "pending",
  "completed",
  "voided",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "card", // Retained for historical sales; new POS checkout is cash only.
  "mobile", // Retained for historical sales; new POS checkout is cash only.
  "credit", // Legacy only; checkout does not accept credit sales.
]);

export const posSessionStatusEnum = pgEnum("pos_session_status", [
  "active",
  "closed",
]);

export const transferStatusEnum = pgEnum("transfer_status", [
  "pending",
  "approved",
  "in_transit",
  "received",
]);

// Supplier Return (Debit Note) lifecycle — §3.3
export const supplierReturnStatusEnum = pgEnum("supplier_return_status", [
  "draft",
  "confirmed",
]);

// Sale Return approval lifecycle — §6.9 (routed to Admin without refund.approve)
export const saleReturnStatusEnum = pgEnum("sale_return_status", [
  "pending",
  "approved",
]);

export const poApprovalStatusEnum = pgEnum("po_approval_status", [
  "pending",
  "approved",
  "rejected",
]);

export const promotionTypeEnum = pgEnum("promotion_type", [
  "percentage",
  "fixed",
  "bundle",
  "seasonal",
]);

export const promotionStatusEnum = pgEnum("promotion_status", [
  "draft",
  "active",
  "expired",
  "deactivated",
]);

export const supplierPaymentMethodEnum = pgEnum("supplier_payment_method", [
  "cash",
  "bank_transfer",
  "mobile_payment",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "in_app",
  "telegram",
]);

export const groundBalanceStatusEnum = pgEnum("ground_balance_status", [
  "pending",
  "completed",
  "cancelled",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
};

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

// ---------------------------------------------------------------------------
// Global / foundation (branch itself + global tables)
// ---------------------------------------------------------------------------

export const branches = pgTable("branch", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 4 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  // §3.3 — operational settings used by §4 R20 (cash alert) and §4 R25 (rounding)
  cashDiscrepancyThreshold: money("cash_discrepancy_threshold")
    .notNull()
    .default("1000"),
  roundingUnit: integer("rounding_unit").notNull().default(50),
  // Batch 2 #6 — tax invoice header fields (IRD-compliant printout).
  registrationNo: varchar("registration_no", { length: 50 }),
  taxInvoicePrefix: varchar("tax_invoice_prefix", { length: 10 }),
  // Batch 2 #12 — POs at/above this total need approval before GRN.
  // Null = no approval gate.
  poApprovalThreshold: money("po_approval_threshold"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Auth sessions — server-side refresh token store (§14.1 hardening).
// Access JWT (1h) is stateless; refresh tokens (7d) are opaque, SHA-256
// hashed at rest, and ROTATED on every use. Reuse of a revoked token
// triggers revocation of all of the user's sessions (theft detection).
// ---------------------------------------------------------------------------

export const authSessions = pgTable(
  "auth_session",
  {
    // jti — also embedded as `sid` in the access JWT.
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    refreshTokenHash: varchar("refresh_token_hash", { length: 64 })
      .notNull()
      .unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    // P2 branch switcher — active branch for this session. Null (legacy rows)
    // falls back to users.branch_id.
    branchId: uuid("branch_id").references(() => branches.id),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("auth_session_user_idx").on(t.userId)],
);

// Global — §16 exception (role defaults, never branch-scoped)
export const permissions = pgTable(
  "permission",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    role: roleEnum("role").notNull(),
    actionKey: varchar("action_key", { length: 50 }).notNull(),
    isAllowed: boolean("is_allowed").notNull().default(false),
  },
  (t) => [
    uniqueIndex("permission_role_action_key_uniq").on(t.role, t.actionKey),
  ],
);

// Global, immutable (no edit/delete API — §10)
export const auditLogs = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    entityId: varchar("entity_id", { length: 100 }).notNull(),
    action: varchar("action", { length: 30 }).notNull(),
    description: varchar("description", { length: 255 }),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    userId: uuid("user_id"),
    branchId: uuid("branch_id"),
    // §10 fix: populated from the request on EVERY entry
    ipAddress: varchar("ip_address", { length: 45 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_user_idx").on(t.userId),
    index("audit_log_branch_idx").on(t.branchId),
  ],
);

// ---------------------------------------------------------------------------
// Identity & staff (§2, §6.1, §7.1)
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    userName: varchar("user_name", { length: 50 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    fullName: varchar("full_name", { length: 100 }).notNull(),
    email: varchar("email", { length: 150 }),
    role: roleEnum("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // Fast terminal PIN for cashiers (bcrypt hash of a 4–6 digit PIN).
    // PIN login never applies to admin/inventory roles.
    pinHash: text("pin_hash"),
    // Admin TOTP 2FA secret (encrypted at rest in a later hardening pass)
    totpSecret: text("totp_secret"),
    // Set once the user proves possession of the secret (first successful
    // TOTP verification). Admin logins require a code once a secret exists.
    totpVerified: boolean("totp_verified").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("users_branch_idx").on(t.branchId)],
);

// ---------------------------------------------------------------------------
// Master data / catalog (§3.1, §6.2, §7.2–7.3)
// ---------------------------------------------------------------------------

export const categories = pgTable(
  "category",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    name: varchar("name", { length: 100 }).notNull(),
    // §3.1 — required for batch barcode format
    shortName: varchar("short_name", { length: 10 }).notNull().unique(),
    // §3.1 — per-category tax (§4 R6); flat cart rate cannot express this
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 })
      .notNull()
      .default("5.00"),
    isTaxExempt: boolean("is_tax_exempt").notNull().default(false),
    isDeleted: boolean("is_deleted").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("category_branch_idx").on(t.branchId)],
);

export const units = pgTable(
  "unit",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    name: varchar("name", { length: 50 }).notNull(),
    shortName: varchar("short_name", { length: 10 }).notNull(),
    isDeleted: boolean("is_deleted").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("unit_branch_idx").on(t.branchId)],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    // Sale (base) unit — purchase unit differs via product_uom_conversion
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    name: varchar("name", { length: 150 }).notNull(),
    reorderThreshold: integer("reorder_threshold").notNull().default(5),
    isDeleted: boolean("is_deleted").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("products_branch_idx").on(t.branchId),
    index("products_category_idx").on(t.categoryId),
  ],
);

// §3.3 — Purchase Unit ≠ Sale Unit (conversion applied once, at GRN confirm)
export const productUomConversions = pgTable(
  "product_uom_conversion",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    purchaseUnitId: uuid("purchase_unit_id")
      .notNull()
      .references(() => units.id),
    saleUnitId: uuid("sale_unit_id")
      .notNull()
      .references(() => units.id),
    conversionFactor: numeric("conversion_factor", {
      precision: 10,
      scale: 4,
    }).notNull(),
    ...timestamps,
  },
  (t) => [index("uom_conversion_product_idx").on(t.productId)],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    name: varchar("name", { length: 150 }).notNull(),
    contactPerson: varchar("contact_person", { length: 100 }),
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 150 }),
    address: varchar("address", { length: 255 }),
    // §3.1 — safe soft-delete replaces the legacy hard cascade
    isDeleted: boolean("is_deleted").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("suppliers_branch_idx").on(t.branchId)],
);

// Supplier ↔ Product M:M (§1 domain 3)
export const supplierProducts = pgTable(
  "supplier_product",
  {
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
  },
  (t) => [
    index("supplier_product_supplier_idx").on(t.supplierId),
    index("supplier_product_product_idx").on(t.productId),
  ],
);

export const counters = pgTable(
  "counter",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    name: varchar("name", { length: 50 }).notNull(),
    location: varchar("location", { length: 100 }),
    isActive: boolean("is_active").notNull().default(true),
    isDeleted: boolean("is_deleted").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("counter_branch_idx").on(t.branchId)],
);

// ---------------------------------------------------------------------------
// Purchasing (PO) + GRN + batch stock (§3.1, §4 R2–R5, §6.3–6.4)
// ---------------------------------------------------------------------------

export const purchaseOrders = pgTable(
  "purchase_order",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    // §5 — PO-{branchCode}-{yyyyMMddHHmmss}, unique + retry-on-collision
    poNumber: varchar("po_number", { length: 40 }).notNull().unique(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    orderDate: timestamp("order_date", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    expectedDate: timestamp("expected_date", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    status: poStatusEnum("status").notNull().default("pending"),
    // Batch 2 #12 — approval gate before GRN. Existing rows backfilled to
    // approved; new POs auto-approve below the branch threshold.
    approvalStatus: poApprovalStatusEnum("approval_status")
      .notNull()
      .default("approved"),
    approvedBy: uuid("approved_by").references(() => users.id),
    // §3.1 — Accounts Payable
    paymentStatus: paymentStatusEnum("payment_status")
      .notNull()
      .default("unpaid"),
    totalAmount: money("total_amount").notNull().default("0"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("po_branch_idx").on(t.branchId),
    index("po_supplier_idx").on(t.supplierId),
  ],
);

export const poDetails = pgTable(
  "po_detail",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    // §4 R5 — always in the PURCHASE unit
    quantity: integer("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
  },
  (t) => [index("po_detail_po_idx").on(t.poId)],
);

export const grns = pgTable(
  "grn",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    // §5 — GRN-{branchCode}-{yyMMddHHmm}
    grnNumber: varchar("grn_number", { length: 40 }).notNull().unique(),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id),
    receivedDate: timestamp("received_date", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    remarks: varchar("remarks", { length: 255 }),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("grn_branch_idx").on(t.branchId),
    index("grn_po_idx").on(t.poId),
  ],
);

// Batch-level stock — THE stock unit (§1). [ASSUMED: no separate grn_detail
// table — each received line IS one items row linked via grn_id; the GRN
// details view reads items by grn_id.]
export const items = pgTable(
  "items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    grnId: uuid("grn_id").references(() => grns.id),
    poId: uuid("po_id").references(() => purchaseOrders.id),
    // §4 R1 — {CategoryShort}-{Year}-{SupplierId:4}-{ProductId:4}-{GRNId:4}
    barcode: varchar("barcode", { length: 50 }).notNull().unique(),
    // §3.1 — original received snapshot (sale-unit qty after conversion)
    receivedQuantity: integer("received_quantity").notNull().default(0),
    // §3.1 — THE live stock balance (sale unit)
    currentStockQuantity: integer("current_stock_quantity")
      .notNull()
      .default(0),
    purchasePrice: money("purchase_price").notNull().default("0"),
    // §3.1 — batch-specific selling price (may differ per batch)
    sellingPrice: money("selling_price").notNull().default("0"),
    expiryDate: date("expiry_date", { mode: "date" }),
    remarks: varchar("remarks", { length: 255 }),
    ...timestamps,
  },
  (t) => [
    index("items_product_branch_idx").on(t.productId, t.branchId),
    index("items_stock_idx").on(t.currentStockQuantity),
    index("items_expiry_idx").on(t.expiryDate),
    index("items_grn_idx").on(t.grnId),
  ],
);

// ---------------------------------------------------------------------------
// POS sessions, sales, cart (§3.2, §4 R6–R11, §6.8, §11)
// ---------------------------------------------------------------------------

export const posSessions = pgTable(
  "pos_session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    counterId: uuid("counter_id")
      .notNull()
      .references(() => counters.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    startTime: timestamp("start_time", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    endTime: timestamp("end_time", { withTimezone: true, mode: "date" }),
    status: posSessionStatusEnum("status").notNull().default("active"),
    notes: varchar("notes", { length: 255 }),
    // §3.2 / §4 R20 — cash/till reconciliation state
    openingCash: money("opening_cash").notNull().default("0"),
    expectedClosingCash: money("expected_closing_cash")
      .notNull()
      .default("0"),
    actualClosingCash: money("actual_closing_cash"),
    cashDifference: money("cash_difference"),
    ...timestamps,
  },
  (t) => [
    index("pos_session_user_idx").on(t.userId),
    index("pos_session_counter_idx").on(t.counterId),
    index("pos_session_branch_idx").on(t.branchId),
    // §4 R19 — one active session per user / per counter (partial unique,
    // enforced at the API layer inside the creation transaction; the partial
    // index is created in a later migration once Drizzle supports it cleanly).
    index("pos_session_status_idx").on(t.status),
  ],
);

export const sales = pgTable(
  "sale",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    // §5 — SALE-{branchCode}-{yyyyMMdd}-{seq:4}
    saleNumber: varchar("sale_number", { length: 40 }).notNull().unique(),
    // §3.1 — session concept was missing from the baseline
    posSessionId: uuid("pos_session_id")
      .notNull()
      .references(() => posSessions.id, { onDelete: "no action" }),
    subtotal: money("subtotal").notNull().default("0"),
    discountAmount: money("discount_amount").notNull().default("0"),
    tax: money("tax").notNull().default("0"),
    totalAmount: money("total_amount").notNull().default("0"),
    // §3.1 — Kyat rounding delta (§4 R25) so reports reconcile exactly
    roundingAdjustment: money("rounding_adjustment")
      .notNull()
      .default("0"),
    grandTotal: money("grand_total").notNull().default("0"),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    paymentReference: varchar("payment_reference", { length: 100 }),
    // Batch 2 #13 — mobile-money tender records provider + transaction id
    // only (no gateway integration). Unique per branch/provider/txn.
    mobileProvider: varchar("mobile_provider", { length: 30 }),
    mobileTransactionId: varchar("mobile_transaction_id", { length: 100 }),
    // Cash tendered; change computed server-side into notes (§4 R7)
    cashReceived: money("cash_received"),
    cardLast4: varchar("card_last4", { length: 4 }),
    // §3.1 — voided added as distinct from Sale Return (§4 R11)
    status: saleStatusEnum("status").notNull().default("completed"),
    voidReason: varchar("void_reason", { length: 255 }),
    notes: text("notes"),
    saleDate: timestamp("sale_date", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("sale_branch_idx").on(t.branchId),
    index("sale_session_idx").on(t.posSessionId),
    index("sale_date_idx").on(t.saleDate),
    // Batch 2 #13 — one mobile transaction id settles exactly one sale
    // per branch/provider (double-claim guard; nulls never conflict).
    uniqueIndex("sale_mobile_txn_uniq")
      .on(t.branchId, t.mobileProvider, t.mobileTransactionId)
      .where(sql`mobile_provider IS NOT NULL AND mobile_transaction_id IS NOT NULL`),
  ],
);

export const saleDetails = pgTable(
  "sale_detail",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id),
    // Specific batch sold (§1 — every sale line references a batch)
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    discount: money("discount").notNull().default("0"),
    // §3.1 — snapshot; Category.tax_rate may change later
    taxRateApplied: numeric("tax_rate_applied", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    lineTotal: money("line_total").notNull().default("0"),
  },
  (t) => [
    index("sale_detail_sale_idx").on(t.saleId),
    index("sale_detail_item_idx").on(t.itemId),
  ],
);

// Persisted cart (§11 — DB-backed, NOT localStorage/in-memory session)
// Supports parked sales: multiple carts per session, one active at a time.
export const carts = pgTable(
  "cart",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    posSessionId: uuid("pos_session_id")
      .notNull()
      .references(() => posSessions.id),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    label: varchar("label", { length: 100 }),
    ...timestamps,
  },
  (t) => [index("cart_session_idx").on(t.posSessionId)],
);

export const cartItems = pgTable(
  "cart_item",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    quantity: integer("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    appliedPromotionId: uuid("applied_promotion_id"),
    taxRateApplied: numeric("tax_rate_applied", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    totalPrice: money("total_price").notNull().default("0"),
  },
  (t) => [index("cart_item_cart_idx").on(t.cartId)],
);

// Sale Return / Refund (§6.9, §7.12)
export const saleReturns = pgTable(
  "sale_return",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    // §5 — RET-{originalSaleNumber}-{seq}
    returnNumber: varchar("return_number", { length: 60 }).notNull().unique(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id),
    reason: varchar("reason", { length: 255 }),
    status: saleReturnStatusEnum("status").notNull().default("pending"),
    refundAmount: money("refund_amount").notNull().default("0"),
    createdBy: uuid("created_by").references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("sale_return_branch_idx").on(t.branchId),
    index("sale_return_sale_idx").on(t.saleId),
  ],
);

export const saleReturnDetails = pgTable(
  "sale_return_detail",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => saleReturns.id),
    saleDetailId: uuid("sale_detail_id")
      .notNull()
      .references(() => saleDetails.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    quantity: integer("quantity").notNull(),
    refundAmount: money("refund_amount").notNull().default("0"),
  },
  (t) => [index("sale_return_detail_return_idx").on(t.returnId)],
);

// ---------------------------------------------------------------------------
// ERP financial extensions (§3.3, §4 R8/R14/R22, §6.7, §6.10)
// ---------------------------------------------------------------------------

export const supplierPayments = pgTable(
  "supplier_payment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    // Nullable — a payment can be a general settlement, not tied to one PO
    poId: uuid("po_id").references(() => purchaseOrders.id),
    amount: money("amount").notNull(),
    paymentDate: date("payment_date", { mode: "date" }).notNull(),
    method: supplierPaymentMethodEnum("method").notNull(),
    reference: varchar("reference", { length: 100 }),
    recordedBy: uuid("recorded_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("supplier_payment_branch_idx").on(t.branchId),
    index("supplier_payment_supplier_idx").on(t.supplierId),
    index("supplier_payment_po_idx").on(t.poId),
  ],
);

// Return-to-Supplier / Debit Note (§6.7, §7.6)
export const supplierReturns = pgTable(
  "supplier_return",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    // §5 — DN-{branchCode}-{yyyyMMddHHmmss}
    debitNoteNumber: varchar("debit_note_number", { length: 40 })
      .notNull()
      .unique(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    grnId: uuid("grn_id").references(() => grns.id),
    returnDate: date("return_date", { mode: "date" }).notNull(),
    reason: varchar("reason", { length: 255 }).notNull(),
    status: supplierReturnStatusEnum("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("supplier_return_branch_idx").on(t.branchId),
    index("supplier_return_supplier_idx").on(t.supplierId),
  ],
);

export const supplierReturnDetails = pgTable(
  "supplier_return_detail",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => supplierReturns.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    quantity: integer("quantity").notNull(),
    unitCost: money("unit_cost").notNull(),
    totalValue: money("total_value").notNull(),
  },
  (t) => [index("supplier_return_detail_return_idx").on(t.returnId)],
);

// Price history (§4 R23 — via app-level hook in the same transaction)
export const productPriceHistory = pgTable(
  "product_price_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    oldPrice: money("old_price").notNull(),
    newPrice: money("new_price").notNull(),
    changedBy: uuid("changed_by").references(() => users.id),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    reason: varchar("reason", { length: 255 }),
  },
  (t) => [index("price_history_product_idx").on(t.productId)],
);

// ---------------------------------------------------------------------------
// Stock operations (§6.5–6.6, Phase 13-ready schema)
// ---------------------------------------------------------------------------

// Stock Transfer — schema ships Day 1 (§16); UI + approve/receive deferred
// to Phase 13 (meaningless with one branch).
export const stockTransfers = pgTable(
  "stock_transfer",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // §5 — TRF-{fromBranchCode}-{toBranchCode}-{yyyyMMddHHmmss}
    transferNumber: varchar("transfer_number", { length: 60 })
      .notNull()
      .unique(),
    fromBranchId: uuid("from_branch_id")
      .notNull()
      .references(() => branches.id),
    toBranchId: uuid("to_branch_id")
      .notNull()
      .references(() => branches.id),
    status: transferStatusEnum("status").notNull().default("pending"),
    createdBy: uuid("created_by").references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [index("stock_transfer_from_idx").on(t.fromBranchId)],
);

export const stockTransferDetails = pgTable(
  "stock_transfer_detail",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => stockTransfers.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    quantity: integer("quantity").notNull(),
  },
  (t) => [index("stock_transfer_detail_transfer_idx").on(t.transferId)],
);

// Ground Balance — count-only stock-take (§3.2, §4 R18). No auto write-back.
export const groundBalances = pgTable("ground_balance", {
  // §5 — PK string GB-{branchCode}-{yyyyMMddHHmmss}
  batchNo: varchar("batch_no", { length: 30 }).primaryKey(),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id),
  gbDate: date("gb_date", { mode: "date" }).notNull(),
  status: groundBalanceStatusEnum("status").notNull().default("pending"),
  remark: varchar("remark", { length: 100 }),
  createdBy: uuid("created_by").references(() => users.id),
  updatedBy: uuid("updated_by").references(() => users.id),
  ...timestamps,
});

export const groundBalanceDetails = pgTable(
  "ground_balance_detail",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchNo: varchar("batch_no", { length: 30 })
      .notNull()
      .references(() => groundBalances.batchNo),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    actualQty: integer("actual_qty").notNull(),
    // Re-looked-up live at save time; any client-sent value is ignored
    inventoryQty: integer("inventory_qty").notNull(),
    differenceQty: integer("difference_qty").notNull(),
    remark: varchar("remark", { length: 100 }),
  },
  (t) => [index("gb_detail_batch_idx").on(t.batchNo)],
);

// ---------------------------------------------------------------------------
// Stock adjustments + operating expenses (ERP must-haves, outside the plan)
// ---------------------------------------------------------------------------

export const adjustmentReasonEnum = pgEnum("adjustment_reason", [
  "damage",
  "loss",
  "found",
  "correction",
]);

// General stock adjustment — damage/loss/found/correction with reason + audit.
// Unlike Ground Balance (count-only), adjustments post immediately.
export const stockAdjustments = pgTable(
  "stock_adjustment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    // ADJ-{branchCode}-{yyyyMMddHHmmss}, unique + retry-on-collision
    adjustmentNumber: varchar("adjustment_number", { length: 40 })
      .notNull()
      .unique(),
    reasonType: adjustmentReasonEnum("reason_type").notNull(),
    reason: varchar("reason", { length: 255 }).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [index("stock_adjustment_branch_idx").on(t.branchId)],
);

export const stockAdjustmentDetails = pgTable(
  "stock_adjustment_detail",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adjustmentId: uuid("adjustment_id")
      .notNull()
      .references(() => stockAdjustments.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    // Signed delta applied to Items.current_stock_quantity (negative = out).
    quantityDelta: integer("quantity_delta").notNull(),
    stockBefore: integer("stock_before").notNull(),
    stockAfter: integer("stock_after").notNull(),
  },
  (t) => [index("stock_adjustment_detail_adj_idx").on(t.adjustmentId)],
);

export const expenseCategories = pgTable(
  "expense_category",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    name: varchar("name", { length: 100 }).notNull(),
    isDeleted: boolean("is_deleted").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("expense_category_branch_idx").on(t.branchId)],
);

export const expenses = pgTable(
  "expense",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategories.id),
    // Nullable — set when this expense was drawn from a petty cash float.
    floatId: uuid("float_id").references(() => pettyCashFloats.id),
    amount: money("amount").notNull(),
    expenseDate: date("expense_date", { mode: "date" }).notNull(),
    method: supplierPaymentMethodEnum("method").notNull().default("cash"),
    notes: varchar("notes", { length: 255 }),
    recordedBy: uuid("recorded_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("expense_branch_idx").on(t.branchId),
    index("expense_date_idx").on(t.expenseDate),
  ],
);

// ---------------------------------------------------------------------------
// Promotions (§7.9 — manual + AI-suggested; AI never auto-activates, §4 R26)
// ---------------------------------------------------------------------------

export const promotions = pgTable(
  "promotion",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    name: varchar("name", { length: 150 }).notNull(),
    type: promotionTypeEnum("type").notNull(),
    // Percentage (0–100) or fixed amount, per type
    value: money("value").notNull().default("0"),
    startDate: date("start_date", { mode: "date" }).notNull(),
    endDate: date("end_date", { mode: "date" }).notNull(),
    status: promotionStatusEnum("status").notNull().default("draft"),
    isAiSuggested: boolean("is_ai_suggested").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("promotion_branch_idx").on(t.branchId),
    index("promotion_status_idx").on(t.status),
  ],
);

export const promotionProducts = pgTable(
  "promotion_product",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    // Required qty of this product to qualify (bundle/combo)
    requiredQuantity: integer("required_quantity").notNull().default(1),
  },
  (t) => [index("promotion_product_promo_idx").on(t.promotionId)],
);

// ---------------------------------------------------------------------------
// Notifications (§3.3, §6.14, §7.16)
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  "notification",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id").references(() => branches.id),
    // Null recipient = broadcast (e.g. all Admins for cash_discrepancy)
    userId: uuid("user_id").references(() => users.id),
    type: varchar("type", { length: 50 }).notNull(),
    title: varchar("title", { length: 150 }).notNull(),
    message: text("message").notNull(),
    channel: notificationChannelEnum("channel").notNull().default("in_app"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notification_user_idx").on(t.userId),
    index("notification_branch_idx").on(t.branchId),
  ],
);

// ---------------------------------------------------------------------------
// Batch 5 — budgets, rosters (ERP control layer)
// ---------------------------------------------------------------------------

// Monthly expense budget per category (YYYY-MM). One row per branch +
// category + month; upserted by the budgets API.
export const expenseBudgets = pgTable(
  "expense_budget",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategories.id),
    month: varchar("month", { length: 7 }).notNull(),
    limitAmount: money("limit_amount").notNull(),
    ...timestamps,
  },
  (t) => [
    index("expense_budget_branch_idx").on(t.branchId),
    uniqueIndex("expense_budget_branch_cat_month_uniq").on(
      t.branchId,
      t.categoryId,
      t.month,
    ),
  ],
);

// Planned shifts — actual attendance derives from POS sessions and staff clock-ins.
export const shiftRosters = pgTable(
  "shift_roster",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    rosterDate: date("roster_date", { mode: "date" }).notNull(),
    plannedStart: varchar("planned_start", { length: 5 }).notNull(),
    plannedEnd: varchar("planned_end", { length: 5 }).notNull(),
    counterId: uuid("counter_id").references(() => counters.id),
    notes: varchar("notes", { length: 255 }),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("shift_roster_branch_date_idx").on(t.branchId, t.rosterDate),
    index("shift_roster_user_idx").on(t.userId),
  ],
);

// Effective-dated daily roster schedules. A schedule's entries apply every
// day from start_date until end_date (null = open). Adding a new schedule
// auto-supersedes any active schedule whose window overlaps: the old
// schedule's end_date becomes (new start_date − 1 day). Roster rows are NOT
// materialised — queries expand schedules on the fly (lib/roster.ts).
export const rosterSchedules = pgTable(
  "roster_schedule",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    name: varchar("name", { length: 150 }).notNull(),
    startDate: date("start_date", { mode: "date" }).notNull(),
    endDate: date("end_date", { mode: "date" }),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("roster_schedule_branch_idx").on(t.branchId),
    index("roster_schedule_branch_start_idx").on(t.branchId, t.startDate),
  ],
);

// One row per staff per schedule — daily (no weekday), applies every day
// within the schedule window.
export const rosterScheduleEntries = pgTable(
  "roster_schedule_entry",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => rosterSchedules.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    plannedStart: varchar("planned_start", { length: 5 }).notNull(),
    plannedEnd: varchar("planned_end", { length: 5 }).notNull(),
    counterId: uuid("counter_id").references(() => counters.id),
    notes: varchar("notes", { length: 255 }),
  },
  (t) => [
    index("roster_schedule_entry_schedule_idx").on(t.scheduleId),
    index("roster_schedule_entry_user_idx").on(t.userId),
  ],
);

// Inventory staff attendance is clocked in/out independently of POS sessions.
export const staffAttendance = pgTable(
  "staff_attendance",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    clockInAt: timestamp("clock_in_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    clockOutAt: timestamp("clock_out_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (t) => [
    index("staff_attendance_branch_clock_in_idx").on(t.branchId, t.clockInAt),
    index("staff_attendance_user_clock_in_idx").on(t.userId, t.clockInAt),
    uniqueIndex("staff_attendance_active_user_uniq")
      .on(t.userId)
      .where(sql`clock_out_at IS NULL`),
  ],
);

export const notificationSubscriptions = pgTable(
  "notification_subscription",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id)
      .unique(),
    telegramChatId: varchar("telegram_chat_id", { length: 50 }).notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("notification_sub_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// General Ledger + petty cash (Batch 1 — ERP financial core)
// ---------------------------------------------------------------------------

export const glAccountTypeEnum = pgEnum("gl_account_type", [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
]);

// Chart of Accounts — GLOBAL (like permissions): one chart shared across
// branches; every posting carries its own branch_id (§16 exception).
export const glAccounts = pgTable(
  "gl_account",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 20 }).notNull().unique(),
    name: varchar("name", { length: 150 }).notNull(),
    type: glAccountTypeEnum("type").notNull(),
    isDeleted: boolean("is_deleted").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("gl_account_code_idx").on(t.code)],
);

export const journalEntries = pgTable(
  "journal_entry",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    entryDate: timestamp("entry_date", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    // What caused this posting: sale | grn | supplier_payment | expense |
    // sale_return | void | stock_adjustment | opening | manual
    refType: varchar("ref_type", { length: 30 }).notNull(),
    refId: varchar("ref_id", { length: 100 }),
    memo: varchar("memo", { length: 255 }),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("journal_entry_branch_date_idx").on(t.branchId, t.entryDate),
    index("journal_entry_ref_idx").on(t.refType, t.refId),
  ],
);

export const journalLines = pgTable(
  "journal_line",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => glAccounts.id),
    debit: money("debit").notNull().default("0"),
    credit: money("credit").notNull().default("0"),
  },
  (t) => [index("journal_line_entry_idx").on(t.entryId)],
);

// Petty cash floats (imprest) — cash issued to a holder; expenses drawn
// against the float reference it; closing reconciles issued vs spent.
export const pettyCashFloats = pgTable(
  "petty_cash_float",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    holderUserId: uuid("holder_user_id")
      .notNull()
      .references(() => users.id),
    issuedAmount: money("issued_amount").notNull(),
    // open | closed
    status: varchar("status", { length: 20 }).notNull().default("open"),
    returnedAmount: money("returned_amount"),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    notes: varchar("notes", { length: 255 }),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [index("petty_cash_float_branch_idx").on(t.branchId)],
);

// Cashier shift handover — blind count vs session-expected cash, recorded
// mid-day without closing the POS session (Batch 2 #9).
export const shiftHandovers = pgTable(
  "shift_handover",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    posSessionId: uuid("pos_session_id")
      .notNull()
      .references(() => posSessions.id),
    outgoingUserId: uuid("outgoing_user_id")
      .notNull()
      .references(() => users.id),
    incomingUserId: uuid("incoming_user_id").references(() => users.id),
    expectedCash: money("expected_cash").notNull(),
    blindCount: money("blind_count").notNull(),
    difference: money("difference").notNull().default("0"),
    notes: varchar("notes", { length: 255 }),
    handedAt: timestamp("handed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [index("shift_handover_branch_idx").on(t.branchId)],
);

// ---------------------------------------------------------------------------
// Multi-branch + hardware enablement
// ---------------------------------------------------------------------------

// Branches a user is allowed to work in (Phase 13-ready access control).
// Every user implicitly keeps users.branch_id; rows here grant extras.
export const userBranches = pgTable(
  "user_branch",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
  },
  (t) => [
    index("user_branch_user_idx").on(t.userId),
    uniqueIndex("user_branch_user_branch_uniq").on(t.userId, t.branchId),
  ],
);

// ---------------------------------------------------------------------------
// App settings — global key/value store for admin-controllable runtime
// switches (Telegram notifications, etc.). Code defaults apply when a key
// is absent, so no seed rows are required.
// ---------------------------------------------------------------------------

export const appSettings = pgTable("app_setting", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull().default(""),
  ...timestamps,
});

// Global provider credentials configured by admins. API keys are AES-GCM
// envelopes produced by lib/ai-model-settings.ts; plaintext keys are never
// stored in this table. Inference and management credentials stay separate.
export const aiApiKeys = pgTable(
  "ai_api_key",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: varchar("provider", { length: 40 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    keyPurpose: varchar("key_purpose", { length: 20 }).notNull().default("inference"),
    permissions: varchar("permissions", { length: 30 }),
    apiKey: text("api_key").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    isActive: boolean("is_active").notNull().default(true),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true, mode: "date" }),
    lastCheckStatus: varchar("last_check_status", { length: 30 }),
    providerLimitsSnapshot: jsonb("provider_limits_snapshot"),
    providerLimitsCheckedAt: timestamp("provider_limits_checked_at", { withTimezone: true, mode: "date" }),
    providerLimitsStatus: varchar("provider_limits_status", { length: 30 }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("ai_api_key_provider_label_uniq").on(t.provider, t.label),
    index("ai_api_key_provider_active_idx").on(t.provider, t.isActive),
    check("ai_api_key_purpose_check", sql`${t.keyPurpose} in ('inference', 'management', 'both')`),
  ],
);

// Selected models, provider-reported limits, and observed usage. Provider
// credentials live in ai_api_key and can be shared by many model rows.
export const aiModels = pgTable(
  "ai_model",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: varchar("provider", { length: 40 }).notNull().default("openrouter"),
    apiKeyId: uuid("api_key_id").notNull().references(() => aiApiKeys.id, { onDelete: "restrict" }),
    modelName: varchar("model_name", { length: 200 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    providerContextLength: integer("provider_context_length"),
    providerMaxOutputTokens: integer("provider_max_output_tokens"),
    providerRequestLimits: jsonb("provider_request_limits"),
    providerLimitsCheckedAt: timestamp("provider_limits_checked_at", { withTimezone: true, mode: "date" }),
    requestsToday: integer("requests_today").notNull().default(0),
    requestsThisMonth: integer("requests_this_month").notNull().default(0),
    totalTokensToday: bigint("total_tokens_today", { mode: "number" }).notNull().default(0),
    totalTokensThisMonth: bigint("total_tokens_this_month", { mode: "number" }).notNull().default(0),
    costUsdToday: numeric("cost_usd_today", { precision: 18, scale: 8, mode: "number" }).notNull().default(0),
    costUsdThisMonth: numeric("cost_usd_this_month", { precision: 18, scale: 8, mode: "number" }).notNull().default(0),
    costReportedToday: boolean("cost_reported_today").notNull().default(false),
    costReportedThisMonth: boolean("cost_reported_this_month").notNull().default(false),
    usageDay: date("usage_day", { mode: "string" }).notNull().default(sql`CURRENT_DATE`),
    usageMonth: date("usage_month", { mode: "string" })
      .notNull()
      .default(sql`date_trunc('month', CURRENT_DATE)::date`),
    isActive: boolean("is_active").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("ai_model_active_sort_idx").on(t.isActive, t.sortOrder),
    uniqueIndex("ai_model_single_default_uniq").on(t.isDefault).where(sql`${t.isDefault} = true`),
    check("ai_model_default_active_check", sql`not ${t.isDefault} or ${t.isActive}`),
  ],
);

// AI chat history is scoped to the signed-in user and their active branch.
// Message metadata keeps a capped result snapshot, but excludes generated SQL.
export const aiChatConversations = pgTable(
  "ai_chat_conversation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 }).notNull(),
    ...timestamps,
  },
  (t) => [
    index("ai_chat_conversation_owner_updated_idx").on(t.userId, t.branchId, t.updatedAt),
  ],
);

export const aiChatMessages = pgTable(
  "ai_chat_message",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull().references(() => aiChatConversations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("complete"),
    modelId: uuid("model_id").references(() => aiModels.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    ...timestamps,
  },
  (t) => [
    index("ai_chat_message_conversation_created_idx").on(t.conversationId, t.createdAt),
    check("ai_chat_message_role_check", sql`${t.role} in ('user', 'assistant')`),
    check("ai_chat_message_status_check", sql`${t.status} in ('pending', 'complete', 'failed')`),
  ],
);
