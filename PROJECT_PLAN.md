# PROJECT_PLAN.md — SmartRetailAI (Next.js Rebuild + ERP + AI Blueprint)

> **Source:** This is a full rewrite that merges three inputs into one build contract: (1) `MiniMark-POS-Project-Proposal.md` — the target system (AI-enhanced, multi-branch POS + Inventory), (2) the legacy `PROJECT_PLAN.md` for **CityMarketPOS** (ASP.NET Core MVC + EF Core + SQL Server, single-branch, no AI) — mined for production-tested operational rules the Proposal was missing, and (3) an **ERP financial extension pass** (Accounts Payable/Receivable, Tax, Cash Reconciliation, UOM Conversion, Return-to-Supplier, Void Sale, Price History, Security, Backup, Telegram Notifications, Localization, Bulk Import) closing the gap between "Inventory + POS" and a system that genuinely earns the **ERP** label.
> **Purpose:** Single source of truth for building **SmartRetailAI** on **Next.js + PostgreSQL (Neon) + Drizzle ORM + Python AI Microservice**. Every business rule, schema fix, API endpoint, UI route, and phase below is final — this document is the build contract, not a proposal to negotiate further.
> This document does **not** repeat the Tech Stack / High-Level Architecture / Folder Structure / ERD diagram — see `SmartRetailAI-Project-Proposal.md` and the attached `.drawio` files for those. This plan is the **operational layer** on top of that architecture.
> **Delivery strategy:** built and launched for **one shop first** (§16), with every table and query written branch-ready from day one so a second branch is a configuration change, not a migration (§17, Phase 13).

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Roles & Authorization Matrix](#2-roles--authorization-matrix)
3. [Database Design — Full Schema (Fixes, Additions & ERP Extensions)](#3-database-design--full-schema-fixes-additions--erp-extensions)
4. [Business Rules & Calculations](#4-business-rules--calculations)
5. [Numbering Conventions](#5-numbering-conventions)
6. [Project Flows](#6-project-flows)
7. [API Endpoints Specification](#7-api-endpoints-specification)
8. [UI / Page List (App Router)](#8-ui--page-list-app-router)
9. [Validation Rules](#9-validation-rules)
10. [Audit Logging Specification](#10-audit-logging-specification)
11. [Session, Cart & Counter Rules](#11-session-cart--counter-rules)
12. [Reports Specification](#12-reports-specification)
13. [Seed Data](#13-seed-data)
14. [Security, Notifications, Backup & Localization](#14-security-notifications-backup--localization)
15. [Migration Notes (Legacy C# → Next.js + AI)](#15-migration-notes-legacy-c--nextjs--ai)
16. [Single-Branch-First Implementation Strategy](#16-single-branch-first-implementation-strategy)
17. [Implementation Phases](#17-implementation-phases)

---

## 1. System Overview

SmartRetailAI is a **multi-branch-ready** retail **ERP + POS + AI** platform (launched single-branch, per §16), covering 7 functional domains:

| #   | Domain                                       | Description                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Identity & Staff (RBAC)                      | Login/logout, staff CRUD, 3 roles + fine-grained permission overrides, 2FA for Admin                                                                                                                                                                            |
| 2   | Catalog / Master Data                        | Category (with tax rate), Unit, Product, Supplier, Customer, Branch, Counter — all soft-deletable                                                                                                                                                               |
| 3   | Purchasing (Inbound) + Accounts Payable      | Supplier ↔ Product M:M, Purchase Orders (master-detail), GRN receiving with batch (`Items`) creation, UOM conversion at receiving, Supplier Payment tracking, Return-to-Supplier (Debit Note)                                                                   |
| 4   | Inventory & Stock                            | Batch-level stock (`Items.current_stock_quantity` — **the stock unit**), stock grouping by PO, low-stock alerts, expiry management, Ground Balance (stock-take, count-only), Stock Transfer between branches, Price History                                     |
| 5   | POS & Sales (Outbound) + Accounts Receivable | Counter selection → POS session (with cash/till reconciliation) → terminal (search/cart/checkout with FEFO batch selection, multi-rate tax, Promotion Engine, cash payment) → session close → Sale Return, Void Sale, Customer credit ledger |
| 6   | AI Layer                                     | RAG (Text-to-SQL), Demand Forecasting, Market Basket/Trend Analysis, AI-Suggested Promotion (admin-gated), Price Optimization, RFM Segmentation                                                                                                                 |
| 7   | Operational & Financial Extensions           | Fine-grained audit trail, Security hardening (2FA, rate-limiting), Multi-channel notifications (in-app + Telegram), Backup/DR, Localization (my/en, Kyat rounding), Bulk CSV/Excel import                                                                       |

**Key architectural fact carried over from the legacy system:** stock is tracked **per batch** (`Items.current_stock_quantity`), **not** per product. Product stock = `SUM(current_stock_quantity)` over its batches **within a branch**. Every sale line references a specific batch (`Sale_Detail.item_id`). This is unchanged from CityMarketPOS — the multi-branch dimension and the ERP financial layer are what's new.

---

## 2. Roles & Authorization Matrix

Roles: `admin`, `inventory`, `cashier` (maps to legacy `Manager`, `Inventory`, `Cashier`).

| Capability                                                                                                  | Admin       | Inventory                                    | Cashier                                                 |
| ----------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------- | ------------------------------------------------------- |
| Login / Logout / Home dashboard                                                                             | ✅          | ✅                                           | ✅                                                      |
| Staff management (create/edit/deactivate users)                                                             | ✅          | ❌                                           | ❌                                                      |
| Branch management (create/edit)                                                                             | ✅          | ❌                                           | ❌                                                      |
| Category / Unit / Product CRUD (incl. tax rate, UOM conversion)                                             | ✅          | ✅                                           | ❌                                                      |
| Supplier / Customer CRUD                                                                                    | ✅          | ✅                                           | ❌                                                      |
| Purchase Order create/list/details                                                                          | ✅          | ✅                                           | ❌                                                      |
| GRN create/list/details/history                                                                             | ✅          | ✅                                           | ❌                                                      |
| Supplier Payment record                                                                                     | ✅          | ✅                                           | ❌                                                      |
| Return-to-Supplier (Debit Note) create                                                                      | ✅          | ✅                                           | ❌                                                      |
| Return-to-Supplier confirm                                                                                  | ✅ (always) | ⚠️ requires `supplier_return.confirm`        | ❌                                                      |
| Stock view + batch details                                                                                  | ✅          | ✅                                           | ❌                                                      |
| Expiry view / write-off / reorder                                                                           | ✅          | ✅                                           | ❌                                                      |
| Stock Transfer create/receive                                                                               | ✅          | ✅                                           | ❌                                                      |
| Stock Transfer approve                                                                                      | ✅          | ⚠️ requires `transfer.approve`               | ❌                                                      |
| Ground Balance (stock-take) CRUD                                                                            | ✅          | ✅                                           | ❌                                                      |
| Counter CRUD                                                                                                | ✅          | ❌                                           | ❌                                                      |
| Promotion create/edit/activate                                                                              | ✅          | ❌                                           | ❌ — view active promotions only                        |
| Manual discount at checkout                                                                                 | ✅          | ❌                                           | ⚠️ requires `discount.approve` (default off)            |
| Credit sale beyond configured amount                                                                        | ✅          | ❌                                           | ⚠️ requires `credit_sale.approve` (default: Admin only) |
| Sale Return / Refund                                                                                        | ✅          | ❌                                           | ⚠️ requires `refund.approve` (default: Admin only)      |
| Void Sale — own current session                                                                             | ✅          | ❌                                           | ✅ (always allowed, same-session only)                  |
| Void Sale — different/closed session                                                                        | ✅          | ❌                                           | ⚠️ requires `void.approve` (default: Admin only)        |
| POS: select counter, open/close session (incl. cash reconciliation), terminal, cart, checkout, today-sales  | ✅          | ❌                                           | ✅                                                      |
| Bulk data import (Products/Suppliers/Categories)                                                            | ✅          | ✅                                           | ❌                                                      |
| Sales report, session report, cash reconciliation report, inventory valuation, profit margin, AP/AR reports | ✅          | ❌                                           | ❌                                                      |
| Audit log view                                                                                              | ✅          | ❌                                           | ❌                                                      |
| Notification settings (link Telegram)                                                                       | ✅          | ✅                                           | ✅ (own account only)                                   |
| AI RAG Chat / Forecasting / RFM dashboard                                                                   | ✅          | ✅ (Inventory-scoped: re-order, forecasting) | ❌                                                      |

> ⚠️ **Fix carried over from a legacy gap:** the legacy system had two unauthenticated MVC actions (`Account/Index|Edit|Delete`, `Home/Index`). In SmartRetailAI, enforce auth on **every** route + API route via `middleware.ts` + server-side session checks. **Default-deny.**

### 2.1 Fine-Grained Permission Keys

The `Permission` table (per Proposal §5.2) implements every ⚠️-marked row above as an **overridable per-role toggle**, keyed by `action_key`, rather than hardcoding it — a capability the legacy system did not have:

| `action_key`              | Default                                    | Governs                                                                    |
| ------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `discount.approve`        | `cashier = false`                          | Manual discount entry at checkout                                          |
| `refund.approve`          | `cashier = false`                          | Creating a Sale Return without routing to an approval queue                |
| `transfer.approve`        | `inventory = true`, `cashier = false`      | Approving a Stock Transfer between branches                                |
| `void.approve`            | `cashier = false`                          | Voiding a sale outside the cashier's own current, still-open session       |
| `credit_sale.approve`     | `cashier = false`                          | Checking out a `credit` payment sale beyond a configurable per-sale amount |
| `supplier_return.confirm` | `inventory = false` (Admin always allowed) | Confirming a Debit Note / Return-to-Supplier                               |

---

## 3. Database Design — Full Schema (Fixes, Additions & ERP Extensions)

The Proposal's ERD (26 entities) is the baseline. This section is the complete, final list of **fixes** to that baseline and **new tables** required to close every gap identified against the legacy system and the ERP requirements — organized by why each change exists.

### 3.1 Fixes to the Proposal's Baseline Tables

| Table                                     | Change                                                                      | Reason                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Category`                                | **Add** `short_name` varchar(10), required, **unique**                      | Barcode format (`Category-Year-Supplier-Product-GRN`, e.g. `E-2026-0001-0001-0001`) requires a category short code that the baseline schema never defined.                                                                                                                                                                                                          |
| `Category`                                | **Add** `tax_rate` decimal(5,2), default `5.00`                             | Different product categories can legally carry different tax rates (§4 Rule 6) — a single flat cart-level rate cannot express this.                                                                                                                                                                                                                                 |
| `Category`                                | **Add** `is_tax_exempt` boolean, default `false`                            | Some categories (e.g. certain essential goods) may be exempt entirely.                                                                                                                                                                                                                                                                                              |
| `Category`, `Unit`, `Products`, `Counter` | **Add** `is_deleted` boolean, default `false`                               | The baseline never specified a soft-delete strategy. All list queries filter `WHERE is_deleted = false`; delete endpoints set this flag — **never hard-delete** master data.                                                                                                                                                                                        |
| `Unit`                                    | **Add** `short_name` varchar(10), required (e.g. `KG`, `PCS`)               | Needed for UI display consistency and matches the Category fix above.                                                                                                                                                                                                                                                                                               |
| `Items`                                   | **Add** `received_quantity` int                                             | Snapshot of the batch's original received quantity (= the GRN line's `count`), kept alongside the live balance for audit/reporting.                                                                                                                                                                                                                                 |
| `Items`                                   | **Add** `current_stock_quantity` int                                        | **The live stock balance** — the baseline schema had no quantity field at all on `Items`, making real-time stock deduction and FEFO selection impossible to implement as written. Decremented on sale, restored on return/void, zeroed on write-off, adjusted on transfer.                                                                                          |
| `Items`                                   | **Add** `selling_price` decimal(12,2)                                       | Batch-specific selling price (entered on the GRN form) — may differ per batch of the same product as cost prices change over time.                                                                                                                                                                                                                                  |
| `Suppliers`                               | **Add** `is_deleted` boolean, default `false`                               | Converts the legacy system's dangerous hard-cascade-delete into a safe soft-delete. Block delete while the supplier has any open (`pending`/`partially_received`) Purchase Order. If a hard delete is ever still required for compliance, it must be **Admin-only + typed confirmation + audit + blocked while any linked batch has `current_stock_quantity > 0`.** |
| `Customers`                               | **Add** `credit_limit` decimal(12,2), nullable (`null` = no limit)          | Required for Accounts Receivable (§3.3).                                                                                                                                                                                                                                                                                                                            |
| `Sale`                                    | **Add** `pos_session_id` FK → `POS_Session`, required, `NoAction` on delete | The baseline had no session concept at all (§3.2).                                                                                                                                                                                                                                                                                                                  |
| `Sale`                                    | Extend `status` enum to `pending / completed / voided`                      | Adds same-day Void as a distinct outcome from Sale Return (§4 Rule 11).                                                                                                                                                                                                                                                                                             |
| `Sale`                                    | **Add** `payment_method` enum value `credit`                                | Required for Accounts Receivable (§3.3).                                                                                                                                                                                                                                                                                                                            |
| `Sale`                                    | **Add** `rounding_adjustment` decimal(12,2), default `0`                    | Kyat currency rounding (§14.4) — keeps reports reconciling exactly instead of silently absorbing rounding differences.                                                                                                                                                                                                                                              |
| `Sale_Detail`                             | **Add** `tax_rate_applied` decimal(5,2)                                     | Snapshot of the tax rate actually charged on that line, since `Category.tax_rate` can change later and historical sales must not be retroactively affected.                                                                                                                                                                                                         |
| `Purchase_Order`                          | **Add** `payment_status` enum (`unpaid / partial / paid`), default `unpaid` | Required for Accounts Payable (§3.3).                                                                                                                                                                                                                                                                                                                               |
| `Notification`                            | **Add** `channel` enum (`in_app / telegram`)                                | Required for multi-channel delivery (§14.2).                                                                                                                                                                                                                                                                                                                        |

> Indexes recommended on `Items`: `(product_id, branch_id)`, `(current_stock_quantity)`, `(expiry_date)`, unique on `barcode`.

### 3.2 New Tables — Core Operational Gaps (present in the legacy system, missing from the Proposal)

**`POS_Session`** — entirely missing from the Proposal, but a core legacy entity enforcing "one cashier, one counter, one active session" and enabling session/cash reports.

| Field                 | Type                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| id                    | PK                                                                                |
| user_id               | FK → Users (cashier)                                                              |
| counter_id            | FK → Counter                                                                      |
| branch_id             | FK → Branch                                                                       |
| start_time            | timestamptz                                                                       |
| end_time              | timestamptz, nullable                                                             |
| status                | enum (`active` / `closed`)                                                        |
| notes                 | varchar(255), nullable                                                            |
| opening_cash          | decimal(12,2) — entered by the cashier at session start                           |
| expected_closing_cash | decimal(12,2) — computed = `opening_cash + Σ(cash sales) − Σ(cash refunds)`       |
| actual_closing_cash   | decimal(12,2), nullable until close — physical count entered at session close     |
| cash_difference       | decimal(12,2), nullable — `actual − expected` (negative = short, positive = over) |

**Uniqueness (app-enforced, partial unique indexes):** one `active` session per user; one `active` session per counter.

**`Ground_Balance`** (header) — a stock-take / physical inventory count feature present in the legacy system but completely absent from the Proposal. **Count-only — no automatic stock write-back.**

| Field                   | Type                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| batch_no                | varchar(30) — **PK (string)**, format `GB-{branchCode}-{yyyyMMddHHmmss}` |
| branch_id               | FK → Branch                                                              |
| gb_date                 | date                                                                     |
| status                  | enum (`pending` / `completed` / `cancelled`)                             |
| remark                  | varchar(100), nullable                                                   |
| created_by              | FK → Users                                                               |
| updated_by              | FK → Users, nullable                                                     |
| created_at / updated_at | timestamptz                                                              |

**`Ground_Balance_Detail`** (count lines)

| Field          | Type                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| id             | PK                                                                                                             |
| batch_no       | FK → Ground_Balance                                                                                            |
| item_id        | FK → Items (the batch being counted)                                                                           |
| actual_qty     | int — physical count                                                                                           |
| inventory_qty  | int — **re-looked-up live** from `Items.current_stock_quantity` at save time; any client-sent value is ignored |
| difference_qty | int — `actual_qty − inventory_qty`                                                                             |
| remark         | varchar(100), nullable                                                                                         |

> Edit behavior: wipes and re-inserts detail lines (matches legacy semantics — the simplest way to avoid partial-update bugs).

### 3.3 New Tables — ERP Financial Extensions

**`Supplier_Payment`** — Accounts Payable.

| Field        | Type                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| id           | PK                                                                                                    |
| supplier_id  | FK → Suppliers                                                                                        |
| po_id        | FK → Purchase_Order, nullable (a payment can also be a general account settlement not tied to one PO) |
| amount       | decimal(12,2)                                                                                         |
| payment_date | date                                                                                                  |
| method       | enum (`cash` / `bank_transfer` / `mobile_payment`)                                                    |
| reference    | varchar, nullable                                                                                     |
| recorded_by  | FK → Users                                                                                            |

**`Customer_Ledger`** — Accounts Receivable.

| Field            | Type                                                     |
| ---------------- | -------------------------------------------------------- |
| id               | PK                                                       |
| customer_id      | FK → Customers                                           |
| sale_id          | FK → Sale, nullable (repayments aren't tied to one sale) |
| type             | enum (`credit_sale` / `payment_received`)                |
| amount           | decimal(12,2)                                            |
| balance_after    | decimal(12,2) — running balance snapshot                 |
| transaction_date | timestamptz                                              |
| recorded_by      | FK → Users                                               |

**`Product_UOM_Conversion`** — Purchase Unit ≠ Sale Unit.

| Field             | Type                                             |
| ----------------- | ------------------------------------------------ |
| id                | PK                                               |
| product_id        | FK → Products                                    |
| purchase_unit_id  | FK → Unit (e.g. "Carton")                        |
| sale_unit_id      | FK → Unit (e.g. "Piece")                         |
| conversion_factor | decimal(10,4) — e.g. `24` (1 carton = 24 pieces) |

**`Supplier_Return`** (header) — Return-to-Supplier / Debit Note.

| Field             | Type                                                            |
| ----------------- | --------------------------------------------------------------- |
| id                | PK                                                              |
| debit_note_number | varchar — format `DN-{branchCode}-{yyyyMMddHHmmss}`             |
| supplier_id       | FK → Suppliers                                                  |
| grn_id            | FK → GRN, nullable (links back to the original receiving event) |
| return_date       | date                                                            |
| reason            | varchar                                                         |
| status            | enum (`draft` / `confirmed`)                                    |

**`Supplier_Return_Detail`**

| Field       | Type                                  |
| ----------- | ------------------------------------- |
| id          | PK                                    |
| return_id   | FK → Supplier_Return                  |
| item_id     | FK → Items (the batch being returned) |
| quantity    | int                                   |
| unit_cost   | decimal(12,2)                         |
| total_value | decimal(12,2)                         |

**`Product_Price_History`**

| Field      | Type              |
| ---------- | ----------------- |
| id         | PK                |
| product_id | FK → Products     |
| old_price  | decimal(12,2)     |
| new_price  | decimal(12,2)     |
| changed_by | FK → Users        |
| changed_at | timestamptz       |
| reason     | varchar, nullable |

**`Notification_Subscription`** — Telegram linkage.

| Field            | Type       |
| ---------------- | ---------- |
| id               | PK         |
| user_id          | FK → Users |
| telegram_chat_id | varchar    |
| is_enabled       | boolean    |

**`Branch`** — extend with two operational settings used by rules in §4 and §14:

| Field                      | Type                          |
| -------------------------- | ----------------------------- | ------------------------------------------------- |
| cash_discrepancy_threshold | decimal(12,2), default `1000` | Cash reconciliation alert threshold (§4 Rule 20). |
| rounding_unit              | int, default `50`             | Kyat currency rounding unit (§14.4).              |

### 3.4 Updated ERD Summary (additions only — see the Proposal's `.drawio` for the full baseline diagram)

```
Users          (1) ───── (M)  POS_Session
Counter        (1) ───── (M)  POS_Session
Branch         (1) ───── (M)  POS_Session
POS_Session    (1) ───── (M)  Sale
Branch         (1) ───── (M)  Ground_Balance
Ground_Balance (1) ───── (M)  Ground_Balance_Detail
Items          (1) ───── (M)  Ground_Balance_Detail
Suppliers      (1) ───── (M)  Supplier_Payment
Purchase_Order (1) ───── (M)  Supplier_Payment
Customers      (1) ───── (M)  Customer_Ledger
Sale           (1) ───── (M)  Customer_Ledger
Products       (1) ───── (M)  Product_UOM_Conversion
Suppliers      (1) ───── (M)  Supplier_Return
GRN            (1) ───── (M)  Supplier_Return
Supplier_Return(1) ───── (M)  Supplier_Return_Detail
Items          (1) ───── (M)  Supplier_Return_Detail
Products       (1) ───── (M)  Product_Price_History
Users          (1) ───── (M)  Notification_Subscription
```

---

## 4. Business Rules & Calculations

Exact formulas — ported from the legacy system's proven logic, extended for multi-branch, ERP financial tracking, and Promotions. This numbered list is the **single authoritative reference** for every calculation in the system.

1. **Batch barcode (`Items.barcode`):** `{Category.short_name}-{Year}-{Supplier.id, 4-digit}-{Product.id, 4-digit}-{GRN.id, 4-digit}` — e.g. `E-2026-0001-0001-0001`.
2. **PO totals:** `total_amount = Σ(quantity × unit_price)` across `PO_Detail` lines, where `quantity`/`unit_price` are always expressed in the **purchase unit** (Rule 5).
3. **PO status recompute (after each GRN):** per product, `SUM(received_quantity) >= ordered_quantity` for **all** lines in the PO → `received`; else → `partially_received`. Starts as `pending`.
4. **GRN batch creation:** only lines with `received_qty > 0` are saved. Creates one `Items` row per line: `received_quantity = current_stock_quantity = received_qty × conversion_factor` (Rule 5); `purchase_price` copied from the PO line; `selling_price`, `expiry_date` from the GRN form.
5. **UOM Conversion:** `PO_Detail.quantity`/`unit_price` are always entered in the **purchase unit** (e.g. cost per carton). At GRN confirmation, `Items.current_stock_quantity = received_quantity × Product_UOM_Conversion.conversion_factor`, converting into the **sale unit** (e.g. pieces). Every downstream operation — checkout, FEFO, low-stock, stock transfer — works exclusively in sale-unit quantities, so this conversion happens at exactly one place: GRN confirm.
6. **Checkout math (order of operations):**
   `subtotal = Σ(line qty × unit_price)`
   → apply **line-level manual discount** (requires `discount.approve`)
   → apply **Bundle/Combo promotion** if the qualifying product combination is present in the cart (does not stack with a manual discount on the same line by default)
   → apply **Seasonal/AI-suggested promotion** if active and not already discounted on that line
   → `discount_amount = Σ(all applied discounts)`
   → **per line:** `line_tax = (line_subtotal − line's share of discount_amount) × (0 if Category.is_tax_exempt else Category.tax_rate)`; snapshot the applied rate into `Sale_Detail.tax_rate_applied`
   → `tax = Σ(line_tax)` (replaces a single flat cart-level rate — different categories may legally carry different rates)
   → `total_amount = subtotal − discount_amount + tax`
   → apply **currency rounding** (Rule 25) → `grand_total`, recording any difference as `rounding_adjustment`
7. **Payments:**
   - `Cash` requires `cash_received >= total_amount` (compute `change` server-side, store as text in `Sale.notes`).
   - Sale checkout accepts cash only; legacy card/mobile sale records remain readable in reports and receipts.
   - `Credit` requires a known `Customer` (Rule 8); disallowed for walk-in/anonymous sales.
8. **Credit sale limit:** a `credit` payment sale is rejected with `409 CREDIT_LIMIT_EXCEEDED` when `Customer.credit_limit` is set and `current_balance + sale_total > credit_limit`, unless the cashier holds `credit_sale.approve`. On success, insert a `Customer_Ledger` row (`type = credit_sale`) and recompute `balance_after`.
9. **Stock decrement:** `Items.current_stock_quantity -= qty` per sale line, inside a **DB transaction with row-level locking** and live re-validation immediately before commit — never trust the client's last-known stock. Insufficient stock → `409 INSUFFICIENT_STOCK`.
10. **Sale Return:** restores `Items.current_stock_quantity += returned_qty`; `refund_amount` computed pro-rata from the original line's `price` minus any discount applied to that line.
11. **Void Sale:** allowed only within the sale's own `POS_Session` and only before that session closes (same-day, same-cashier by default). Restores stock for every `Sale_Detail` line, exactly like a return, but is recorded as `Sale.status = voided` (audit action `void`) rather than a `Sale_Return` row — it represents "this sale should never have completed," not "the customer brought the product back." Voiding a sale from a different or already-closed session requires `void.approve`.
12. **Stock Transfer:** decrements `current_stock_quantity` at the source branch's `Items` row on `approved`/`in_transit`; on `received`, either increments the matching batch at the destination branch or creates a new `Items` row scoped to the destination branch. Status flow: `pending → approved → in_transit → received`.
13. **Write-off:** sets `Items.current_stock_quantity = 0`; requires a reason; audit `write_off`.
14. **Return-to-Supplier (Debit Note):** on `confirm`, `Items.current_stock_quantity -= quantity` (removes damaged/wrong stock from the books); if the related PO's `payment_status` is `unpaid`/`partial`, reduces the outstanding payable by `total_value`, or is recorded as a credit against the supplier's next PO otherwise.
15. **FEFO + cheapest-price hint:** the POS terminal suggests batches `WHERE current_stock_quantity > 0 ORDER BY expiry_date ASC`; a product's displayed price = `MIN(selling_price)` across its batches (same branch); available quantity = `SUM(current_stock_quantity)` (same branch).
16. **Low stock:** per batch, `current_stock_quantity <= Products.reorder_threshold`. Branch dashboard widgets group/sum per product, but the underlying alert logic preserves **per-batch** semantics (do not silently change this to a summed-only check).
17. **Expiry buckets:** `expired`: `expiry_date < now`; `expiring_soon`: `now <= expiry_date <= now + threshold` (default 30 days; dashboard widget uses 7 days; stock filter uses 30 days).
18. **Ground Balance:** count-only. `difference_qty = actual_qty − inventory_qty` (live lookup at save time). **No automatic stock write-back.** Edit wipes and re-inserts lines.
19. **POS Session exclusivity:** one `active` session per user **and** one `active` session per counter, both enforced at the API layer with a DB check inside the same transaction as session creation.
20. **Cash/Till Reconciliation:** `EndSession` requires `actual_closing_cash` before it will close. If `ABS(cash_difference) > Branch.cash_discrepancy_threshold`, create a `Notification` (`type = cash_discrepancy`) to Admin. The reconciliation values are stored in the session's audit `new_values` JSON so repeated shortages by the same cashier are traceable over time.
21. **Offline Mode reconciliation:** a sale created offline is stored locally with `is_synced = false` and a client-generated temporary ID. On reconnect, the server **re-validates stock** for every line; if stock is now insufficient, the sale is **not silently rejected** — it is flagged for manager review (`Notification` type `sync_conflict`) rather than auto-discarded, since the physical sale already happened.
22. **Accounts Payable status recompute:** `Purchase_Order.payment_status` recomputes after every `Supplier_Payment`: `SUM(payments for this po) >= po.total_amount` → `paid`; `> 0` → `partial`; else `unpaid`.
23. **Price History logging:** whenever a batch's `Items.selling_price` is edited post-creation, insert one `Product_Price_History` row (via a DB trigger or an application-level hook in the same transaction). This is separate from `Sale_Detail.price`, which already captures the price actually charged at sale time.
24. **Timestamps:** store **UTC** (`timestamptz`) everywhere; render in branch/viewer timezone (default `Asia/Yangon`). Do **not** use server-local time — this was a legacy bug.
25. **Money precision & currency rounding:** all money columns `decimal(12,2)`; never use `float`/`double` for currency math in application code (use `decimal.js` on the Next.js side). Additionally, round `Sale.grand_total` to the nearest `Branch.rounding_unit` (default 50 Ks, since coins below that are not in practical circulation), recording the delta as `Sale.rounding_adjustment` so reports reconcile exactly rather than silently absorbing the difference.
26. **AI-Suggested Promotion approval:** an AI-generated `Promotion` row is created with `status = draft` and `is_ai_suggested = true`. It only becomes usable at checkout once an Admin flips `status` to `active` — **AI never activates a promotion unsupervised.**

---

## 5. Numbering Conventions

All numbers use a **branch code** prefix (2–4 letters, e.g. `YGN`, `MDY`) so that numbers stay human-traceable across branches without looking up an ID.

| Entity                          | Format                                                          | Example                        |
| ------------------------------- | --------------------------------------------------------------- | ------------------------------ |
| Purchase Order                  | `PO-{branchCode}-{yyyyMMddHHmmss}`                              | `PO-YGN-20261005143210`        |
| PO (reorder-prefill variant)    | `PO-{branchCode}-RO-{yyyyMMddHHmmss}`                           | `PO-YGN-RO-20261005143210`     |
| GRN                             | `GRN-{branchCode}-{yyMMddHHmm}`                                 | `GRN-YGN-2610051432`           |
| Batch barcode                   | `{CategoryShort}-{Year}-{SupplierId:4}-{ProductId:4}-{GRNId:4}` | `E-2026-0001-0001-0001`        |
| Sale                            | `SALE-{branchCode}-{yyyyMMdd}-{sequence:4}`                     | `SALE-YGN-20261005-0042`       |
| Sale Return                     | `RET-{originalSaleNumber}-{seq}`                                | `RET-SALE-YGN-20261005-0042-1` |
| Stock Transfer                  | `TRF-{fromBranchCode}-{toBranchCode}-{yyyyMMddHHmmss}`          | `TRF-YGN-MDY-20261005143210`   |
| Ground Balance batch            | `GB-{branchCode}-{yyyyMMddHHmmss}`                              | `GB-YGN-20261005143210`        |
| Debit Note (Return-to-Supplier) | `DN-{branchCode}-{yyyyMMddHHmmss}`                              | `DN-YGN-20261005143210`        |

**Uniqueness:** enforce via a DB unique constraint on the generated string, with retry-on-collision in application code (do not rely on a DB sequence table alone, since branch/date components are embedded in the string itself).

---

## 6. Project Flows

### 6.1 Auth & Staff Flow

```
Login (public) → credential check (+ 2FA if Admin, §14.1) → role + branch resolved → redirect to role dashboard
Admin → Staff list → Create user (username/password/fullName/role/branch) → Edit → Deactivate (soft)
Logout: if user has an Active POS_Session → auto-close (status=closed, end_time=now) + audit `close` + clear cart → sign out
```

### 6.2 Catalog Setup Flow (Admin/Inventory)

```
Category (name, short_name unique, tax_rate, is_tax_exempt) → Unit (name, short_name)
→ Product (name, category, unit, reorder_threshold=5) → optional Product_UOM_Conversion (purchase_unit → sale_unit, factor)
→ Supplier (contact, phones, email unique-checked, address, linked Products M:M)
→ Customer (name, phone, optional credit_limit)
→ Branch (Admin only) → Counter (Admin only, scoped to a Branch)
All master data uses soft-delete. Every mutation → audit log.
```

### 6.3 Purchasing (PO) & Accounts Payable Flow

```
PO Create: pick Branch → pick Supplier → filter Categories/Products by supplier → rows (Product, Qty≥1 in purchase unit, UnitPrice)
  → PO number auto → order_date=now, expected_date=+7d, status=pending, payment_status=unpaid, total=Σ → audit Create
PO Index: filters (branch, supplier, order_date, status, payment_status, product, category) → Details → [Create GRN] / [GRN History] / [Record Payment]
Record Payment: {amount, method, reference} → insert Supplier_Payment → recompute PO.payment_status → audit Create
```

### 6.4 GRN / Receiving Flow

```
GRN Create (?poId=): load PO lines + already-received map → per line enter ReceivedQty (purchase unit), ExpiryDate?, SellingPrice, Remarks
  → only ReceivedQty>0 saved → GRN number auto → transaction: insert GRN + Items (barcode auto, qty converted to sale unit via §4 Rule 5) → recompute PO status → audit Create
GRN Index: filters (branch, poNumber contains, receivedDate) → Details (batch lines) → DetailsByPO
```

### 6.5 Stock, Expiry & Ground Balance Flow

```
Stock Index: query Items+joins → filters (branch, search name/barcode, category, lowStock, expiringSoon) → group by PO → batch Details
Expiry Index (?daysThreshold=30): batches with expiry<=now+threshold AND stock>0 → Expired vs Soon badges + counts
  → WriteOff (confirm + reason): stock=0 + audit write_off
  → Reorder: prefill new PO (supplier, items, qty, price) → Confirm creates Pending PO (+7d) + audit reorder
Ground Balance Create: batch_no auto → branch, date, remark → cascade Supplier→Category→Item (stock>0 only) → enter ActualQty per line
  → server re-looks-up InventoryQty live, computes Difference → save Pending + audit Create
Ground Balance Index/Details/Edit(wipe+reinsert)/Delete — mirrors legacy exactly (§3.2)
```

### 6.6 Stock Transfer Flow _(new — not in legacy)_

```
Create: from_branch, to_branch, select batches/qty (stock>0 at from_branch) → status=pending → audit Create
Approve (requires transfer.approve): status=approved → audit Approve
In-Transit: source Items.current_stock_quantity decremented → status=in_transit
Receive (at destination): destination Items row created/incremented → status=received → audit Receive
```

### 6.7 Return-to-Supplier (Debit Note) Flow _(new)_

```
From a GRN's batch list → select item(s) to return + reason → create Supplier_Return (status=draft) + Supplier_Return_Detail lines → audit Create
Confirm (requires supplier_return.confirm): Items.current_stock_quantity -= qty for each line;
  reduce PO's outstanding payable or record credit against next PO → status=confirmed → audit Confirm
```

### 6.8 POS Sale Flow (Cashier/Admin) — most critical, unchanged core logic + ERP layer

```
1. SelectCounter: if user has Active session → restore + go Terminal; else list Active counters (this branch) → POST counterId + openingCash
   (reject: counter inactive / already in use) → create Active session (opening_cash recorded) + audit Create → Terminal
2. Terminal: load session + categories + products + per-product {availableStock SUM, startingPrice MIN} (branch-scoped)
   Search (name/barcode, ≤20) → GetProductStock (batches stock>0 ORDER BY expiry — FEFO) → AddToCart (validate session, qty, batch match, live stock; merge same batch)
   → UpdateCart / RemoveFromCart / GetCart (subtotal, promotion evaluation, per-line tax, total, itemCount) / ClearCart
   → If offline: cart persisted to IndexedDB; checkout queued locally with is_synced=false
3. CompleteSale (TRANSACTION): re-validate session + each line's live stock → Sale number auto →
   apply Promotion Engine + per-line tax + rounding (§4 Rule 6) → validate payment method (incl. credit limit, Rule 8) → compute totals →
   insert Sale (completed) + Sale_Detail → decrement batch stock → insert Customer_Ledger row if credit → clear cart → audit Create →
   publish `sale-created` event to Redis Stream (for Market Basket Analysis) → return receipt JSON → print
4. Void (same session, before close): POST /api/pos/sales/:id/void {reason} → restores stock → Sale.status=voided → audit void
5. TodaySales: today's sales for this cashier + totals
6. EndSession: enter actual_closing_cash → show SessionReport (session, sales, totals, cash_difference) → Confirm →
   Closed + end_time + audit close (incl. cash reconciliation values) → clear session → Notification if |cash_difference| exceeds threshold
```

### 6.9 Sale Return Flow _(new — not in legacy)_

```
Lookup original Sale by sale_number → select line(s) to return (full or partial qty)
  → if refund.approve permission missing, route to Admin approval queue
  → on approve: restore Items.current_stock_quantity, compute refund_amount, insert Sale_Return + Sale_Return_Detail → audit Create
```

### 6.10 Customer Credit & Repayment Flow _(new)_

```
At checkout, cashier selects payment_method=credit + existing Customer → system validates credit_limit (§4 Rule 8) →
  Sale completes → Customer_Ledger row (type=credit_sale) inserted, balance_after updated
Repayment (any time): Admin/Inventory opens Customer → Record Payment {amount, method} →
  Customer_Ledger row (type=payment_received) inserted, balance_after reduced → audit Create
Customer Ledger view: running balance history, current outstanding balance
```

### 6.11 Reporting & Audit Flow (Admin)

```
Sales Report (default today): filters (branch, start, end inclusive, cashier, counter) → sales + totals
Inventory Valuation: group stock>0 by Category (per branch or all): {totalStock, costValue, potentialRevenue, profit} + grand totals
Profit Margin Report: per product/category, (sellingPrice - purchasePrice) × unitsSold, over a date range
Session Report: any session → SessionReportViewModel (incl. cash reconciliation)
Cash Reconciliation Report: per cashier/branch, discrepancy trend over a date range
Accounts Payable Report: outstanding balance per supplier, aging (0-30/31-60/60+ days unpaid)
Accounts Receivable Report: outstanding balance per customer, near-limit customers flagged
Supplier Performance: on-time delivery rate, PO fulfillment rate (from Supplier_Delivery)
Audit Log: filters (entityType, action, user, branch, search) → Details (old/new values)
```

### 6.12 AI Flows (new — not in legacy)

```
RAG Chat: user question → POS enqueues job to Redis Stream → AI Processor runs Text-to-SQL → streams answer back via SSE
Demand Forecasting: Celery Beat nightly job → per branch/product forecast → stored → surfaced on Inventory dashboard
Market Basket → AI-Suggested Promotion: triggered by `sale-created` events accumulating → periodic Apriori/FP-Growth run →
  candidate Promotion rows created as `draft` → Admin reviews → activates or discards (§4 Rule 26)
```

### 6.13 Bulk Data Import Flow _(new)_

```
Download template (GET /api/products/import/template) → upload CSV/Excel →
  POST ?mode=preview: parse (Papaparse/SheetJS), validate every row, return {validRows, errorRows} — writes nothing yet
User reviews errors, fixes file, re-uploads if needed →
  POST ?mode=commit: writes all valid rows in one transaction → audit one summary entry {importedCount, skippedCount}
```

### 6.14 Notification / Telegram Setup Flow _(new)_

```
User opens /settings/notifications → sees a one-time linking code →
  sends the code to the SmartRetailAI Telegram bot → bot verifies against a short-lived Redis-cached pending code →
  stores telegram_chat_id in Notification_Subscription → is_enabled=true
From then on: any Notification created (low-stock, expiry, cash-discrepancy, sync-conflict) is also pushed to Telegram
  for every user with an enabled subscription, via the ai-processors Celery task `notifications.py`
```

---

## 7. API Endpoints Specification

Conventions: `GET` list/detail, `POST` create/action, `PATCH` update, `DELETE` soft-delete. Auth roles: `A`=Admin, `I`=Inventory, `C`=Cashier. All mutating endpoints validate with `zod` and write an audit entry. Pagination: `?page=&pageSize=` on all index endpoints. Errors: `400` validation, `401` unauthenticated, `403` wrong role/permission, `404` not found, `409` conflict (duplicate unique / insufficient stock / counter in use / credit limit exceeded).

### 7.1 Auth & Staff — `/api/auth`, `/api/staff` (A)

| Method    | Path               | Notes                                                                                       |
| --------- | ------------------ | ------------------------------------------------------------------------------------------- |
| POST      | `/api/auth/login`  | `{userName, password, totpCode?}` → session cookie; `totpCode` required for `admin` (§14.1) |
| POST      | `/api/auth/logout` | auto-closes Active POS_Session + audit `close`                                              |
| GET/POST  | `/api/staff`       | list / create `{userName, password, fullName, role, branchId}`                              |
| GET/PATCH | `/api/staff/:id`   | view / edit                                                                                 |
| DELETE    | `/api/staff/:id`   | deactivate (soft)                                                                           |

### 7.2 Branches & Counters — `/api/branches` (A), `/api/counters` (A)

Standard CRUD; Counter scoped to `branchId`; soft-delete. Branch payload includes `cash_discrepancy_threshold`, `rounding_unit`.

### 7.3 Categories / Units / Products / Suppliers / Customers — (A,I)

Standard CRUD (mirrors legacy §8.2–8.5 of the reference plan), **plus**:

- `short_name` on categories/units; `tax_rate`/`is_tax_exempt` on categories.
- `GET/POST /api/products/:id/uom-conversion` — manage purchase↔sale unit factor.
- `GET/POST /api/customers`, incl. `credit_limit`; Supplier delete requires typed confirmation (§3.1).
- `POST /api/products/import/template`, `POST /api/products/import?mode=preview|commit` (§6.13).

### 7.4 Purchase Orders & Accounts Payable — `/api/purchase-orders` (A,I)

| Method   | Path                             | Notes                                                                                            |
| -------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| GET      | `/api/purchase-orders`           | `?branchId=&supplierId=&status=&paymentStatus=&productId=&categoryId=`                           |
| POST     | `/api/purchase-orders`           | `{branchId, supplierId, items:[{productId, quantity, unitPrice}]}`                               |
| GET      | `/api/purchase-orders/:id`       | details, incl. payment history                                                                   |
| GET      | `/api/purchase-orders/lookups/*` | supplier→category→product cascades                                                               |
| GET/POST | `/api/supplier-payments`         | list / record `{supplierId, poId?, amount, method, reference?}` — recomputes PO `payment_status` |

### 7.5 GRN — `/api/grn` (A,I)

| Method | Path                                    | Notes                                                                                                                              |
| ------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/grn`                              | `?branchId=&poNumber=&receivedDate=`                                                                                               |
| GET    | `/api/grn/:id` / `/api/grn/by-po/:poId` | details / history                                                                                                                  |
| POST   | `/api/grn`                              | `{poId, lines:[{productId, receivedQty, expiryDate?, sellingPrice, remarks?}]}` — transaction, UOM conversion, PO status recompute |

### 7.6 Stock, Expiry & Return-to-Supplier — `/api/stock`, `/api/expiry`, `/api/supplier-returns` (A,I)

| Method   | Path                                | Notes                                                                              |
| -------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| GET      | `/api/stock`                        | `?branchId=&search=&categoryId=&lowStock=&expiringSoon=`                           |
| GET      | `/api/stock/:itemId`                | batch detail, incl. price history                                                  |
| GET      | `/api/expiry`                       | `?branchId=&daysThreshold=30`                                                      |
| POST     | `/api/expiry/:itemId/write-off`     | `{reason}` — **POST**, never GET                                                   |
| POST     | `/api/expiry/reorder`               | creates Pending PO                                                                 |
| GET/POST | `/api/supplier-returns`             | list / create `{supplierId, grnId?, lines:[{itemId, quantity, unitCost}], reason}` |
| POST     | `/api/supplier-returns/:id/confirm` | requires `supplier_return.confirm` — decrements stock, adjusts payable             |

### 7.7 Stock Transfer — `/api/stock-transfers` (A,I)

| Method   | Path                               | Notes                                                             |
| -------- | ---------------------------------- | ----------------------------------------------------------------- |
| GET/POST | `/api/stock-transfers`             | list / create `{fromBranchId, toBranchId, items:[{itemId, qty}]}` |
| POST     | `/api/stock-transfers/:id/approve` | requires `transfer.approve`                                       |
| POST     | `/api/stock-transfers/:id/receive` | destination confirms receipt                                      |

### 7.8 Ground Balance — `/api/ground-balance` (A,I)

Mirrors the legacy reference plan exactly, scoped by `branchId`: `GET/POST /api/ground-balance`, `GET/PATCH/DELETE /api/ground-balance/:batchNo`, plus lookup endpoints (`inventory-qty`, `suppliers`, `categories`, `items`).

### 7.9 Promotions — `/api/promotions` (A) _(new)_

| Method       | Path                           | Notes                                                               |
| ------------ | ------------------------------ | ------------------------------------------------------------------- |
| GET/POST     | `/api/promotions`              | list / create manual promotion (`percentage/fixed/bundle/seasonal`) |
| GET          | `/api/promotions/ai-suggested` | list `draft` + `is_ai_suggested=true` rows for review               |
| POST         | `/api/promotions/:id/activate` | Admin approves an AI-suggested promotion                            |
| PATCH/DELETE | `/api/promotions/:id`          | edit / deactivate                                                   |

### 7.10 POS Sessions — `/api/pos-sessions` (C,A)

| Method   | Path                           | Notes                                                                                                             |
| -------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| GET/POST | `/api/pos-sessions/select`     | restore-or-list / create `{counterId, openingCash}`                                                               |
| GET      | `/api/pos-sessions/current`    | resolve current session                                                                                           |
| GET      | `/api/pos-sessions/:id/report` | session report, incl. cash reconciliation                                                                         |
| POST     | `/api/pos-sessions/:id/close`  | `{actualClosingCash}` — required; computes `cash_difference`, fires Notification if over threshold; close + audit |

### 7.11 POS Terminal / Cart / Checkout / Void — `/api/pos` (C,A)

Mirrors the legacy reference plan's terminal/cart/checkout endpoints, **plus**: promotion evaluation and per-line tax in `GetCart`/`Checkout`; `credit` as a payment method (with limit check); offline-aware `POST /api/pos/checkout/sync` for replaying queued offline sales (re-validates stock, flags conflicts per §4 Rule 21); and:

| Method | Path                      | Notes                                                                 |
| ------ | ------------------------- | --------------------------------------------------------------------- |
| POST   | `/api/pos/sales/:id/void` | `{reason}` — same-session free; other session requires `void.approve` |

### 7.12 Sale Return — `/api/sale-returns` (A, C-with-permission) _(new)_

| Method | Path                            | Notes                                                                                            |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| GET    | `/api/sale-returns`             | list                                                                                             |
| POST   | `/api/sale-returns`             | `{saleId, lines:[{saleDetailId, quantity, disposition?}]}` — routes to approval if `refund.approve` missing |
| POST   | `/api/sale-returns/:id/approve` | Admin approval step                                                                              |

### 7.13 Customers & Ledger — `/api/customers` (A,I; cashier read-only at checkout) _(new)_

| Method | Path                          | Notes                                      |
| ------ | ----------------------------- | ------------------------------------------ |
| GET    | `/api/customers/:id/ledger`   | full transaction history + current balance |
| POST   | `/api/customers/:id/payments` | record a repayment `{amount, method}`      |

### 7.14 Reports — `/api/reports` (A)

`sales`, `inventory-valuation`, `profit-margin`, `sessions/:id`, `cash-reconciliation` _(new)_, `accounts-payable` _(new)_, `accounts-receivable` _(new)_, `supplier-performance`.

### 7.15 Audit Logs — `/api/audit-logs` (A)

`GET /api/audit-logs?entityType=&action=&userId=&branchId=&search=&page=`, `GET /api/audit-logs/:id`.

### 7.16 Notifications — `/api/notifications` (all roles, own account) _(new)_

| Method    | Path                           | Notes                                                          |
| --------- | ------------------------------ | -------------------------------------------------------------- |
| GET       | `/api/notifications/link-code` | generates a one-time Telegram linking code (Redis, TTL 10 min) |
| GET/PATCH | `/api/notifications/settings`  | view/toggle own subscription                                   |

### 7.17 AI — `/api/ai` (A,I) _(new — see Proposal §6.3/§7 for transport detail)_

| Method | Path              | Notes                                                                                                        |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/ai/enqueue` | dispatch job to Redis Stream (`rag_query`, `forecast`, `promotion_suggest`, `price_optimize`, `rfm_segment`) |
| GET    | `/api/ai/sse`     | SSE relay endpoint streaming AI Processor results to the browser                                             |

---

## 8. UI / Page List (App Router)

### 8.1 Auth & Shell

| Route                     | Roles             | Contents                                                                                                                       |
| ------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/login`                  | public            | login form (+ TOTP field for Admin)                                                                                            |
| `/`                       | all               | role dashboard — low-stock widget, expiring-7d widget, branch KPI cards (Admin), Active session card or counter list (Cashier) |
| `/settings/notifications` | all (own account) | Telegram link code + toggle                                                                                                    |

### 8.2 Staff & Branches (Admin)

`/staff`, `/staff/new`, `/staff/[id]/edit`, `/branches`, `/branches/new`, `/branches/[id]/edit`, `/counters` + CRUD.

### 8.3 Master Data (Admin, Inventory)

`/categories` (incl. tax rate fields), `/units`, `/products` (incl. UOM conversion sub-form), `/suppliers`, `/customers` (incl. credit limit) — table + create/edit modals.

### 8.4 Purchasing, GRN & Payables (Admin, Inventory)

`/purchase-orders`, `/purchase-orders/[id]` (incl. payment history + Record Payment action), `/grn`, `/grn/new?poId=`, `/grn/[id]`, `/grn/by-po/[poId]`, `/supplier-payments`.

### 8.5 Stock, Expiry, Ground Balance, Stock Transfer, Supplier Return (Admin, Inventory)

`/stock`, `/stock/[itemId]` (incl. price history), `/expiry`, `/expiry/[itemId]`, `/expiry/[itemId]/reorder`,
`/ground-balance`, `/ground-balance/new`, `/ground-balance/[batchNo]`, `/ground-balance/[batchNo]/edit`,
`/stock-transfers`, `/stock-transfers/new`, `/stock-transfers/[id]`,
`/supplier-returns`, `/supplier-returns/new`, `/supplier-returns/[id]`.

### 8.6 Promotions (Admin)

`/promotions`, `/promotions/new`, `/promotions/ai-suggested` (review queue), `/promotions/[id]/edit`.

### 8.7 POS (Cashier, Admin)

`/pos/select-counter` (incl. opening cash entry), `/pos/terminal`, `/pos/today-sales`, `/pos/end-session` (incl. actual cash entry), `/pos/sale-returns/new`.

### 8.8 Customers & Credit (Admin, Inventory)

`/customers/[id]/ledger`, `/customers/[id]/payments/new`.

### 8.9 Reports & Audit (Admin)

`/reports/sales`, `/reports/inventory-valuation`, `/reports/profit-margin`, `/reports/sessions/[sessionId]`, `/reports/cash-reconciliation`, `/reports/accounts-payable`, `/reports/accounts-receivable`, `/reports/supplier-performance`, `/audit-logs`, `/audit-logs/[id]`.

### 8.10 Bulk Import (Admin, Inventory)

`/products/import` — template download, upload, preview, confirm.

### 8.11 AI (Admin, Inventory)

`/ai/chat` (RAG Text-to-SQL interface), `/ai/forecasting`, `/ai/rfm-segments`.

Total: **~55 routes.** Every table needs: search/filter, pagination, empty state, loading state, role-gated buttons.

---

## 9. Validation Rules

- `Category`/`Unit`: name required; `short_name` required + unique (edit excludes self); `tax_rate ≥ 0`.
- `Product`: name required; `category_id`/`unit_id` required; `reorder_threshold ≥ 0` (default 5).
- `Product_UOM_Conversion`: `conversion_factor > 0`; `purchase_unit_id ≠ sale_unit_id`.
- `Supplier`: name required; email format if given, unique case-insensitive; phones unique; `product_ids` must exist and not be soft-deleted.
- `Customer`: name required; `credit_limit ≥ 0` if set.
- `Branch`: name required, unique branch code; `rounding_unit > 0`.
- `PO create`: `supplier_id`, `branch_id` required + exist; ≥1 item; each `product_id` exists, `quantity ≥ 1`, `unit_price ≥ 0`.
- `Supplier Payment`: `amount > 0`; cannot exceed the PO's remaining unpaid balance (warn, do not hard-block — overpayment may be a deliberate advance).
- `GRN create`: `po_id` exists; arrays aligned; at least one `received_qty > 0`; `selling_price ≥ 0`; expiry optional date.
- `Cart`: `quantity ≥ 1`; batch must belong to the product; qty ≤ live `current_stock_quantity` (re-checked at checkout inside a transaction).
- `Checkout`: Cash only → `cash_received >= total_amount`; all → an Active session required.
- `Void`: only the sale's own session (unless `void.approve`); reason required.
- `Stock Transfer`: `from_branch_id ≠ to_branch_id`; qty ≤ live stock at source.
- `Sale Return`: qty ≤ originally sold qty on that line; reason is optional.
- `Supplier Return`: qty ≤ item's `current_stock_quantity`; reason required.
- `Promotion`: `end_date >= start_date`; bundle type requires ≥2 `Promotion_Product` rows.
- `Ground Balance`: ≥1 line; `item_id` must exist; `actual_qty ≥ 0`; server ignores client-sent `inventory_qty`.
- `Session select`: counter must be `active` + have no other active session; `opening_cash ≥ 0`.
- `Session close`: `actual_closing_cash` required, `≥ 0`.
- `Staff`: `user_name` unique; password policy (min 8 chars + upper/lower/digit); role must be one of the 3.
- `Bulk import row`: same field-level rules as the corresponding single-entity create endpoint; duplicate rows within the same file are rejected, not merged.

---

## 10. Audit Logging Specification

Helper: `audit(entityType, entityId, action, description?, oldValues?, newValues?)` — called server-side with the current user, branch, and IP.

| Trigger                                                                    | EntityType                     | Action                                                 |
| -------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------ |
| Category/Product/Supplier/Unit/Counter/Branch/Customer create              | each                           | `create`                                               |
| Category/Product/Supplier/Unit/Counter/Branch/Customer edit                | each                           | `update` (include old/new JSON)                        |
| Category/Product/Unit/Counter delete                                       | each                           | `soft_delete`                                          |
| Supplier delete                                                            | `Supplier`                     | `delete` (hard) or `soft_delete` per §3.1 policy       |
| PO create / reorder                                                        | `PurchaseOrder`                | `create` / `reorder`                                   |
| Supplier Payment record                                                    | `SupplierPayment`              | `create`                                               |
| GRN confirm                                                                | `GRN`                          | `create`                                               |
| Supplier Return create / confirm                                           | `SupplierReturn`               | `create` / `confirm`                                   |
| Sale checkout                                                              | `Sale`                         | `create`                                               |
| Sale void                                                                  | `Sale`                         | `void`                                                 |
| Sale Return create / approve                                               | `SaleReturn`                   | `create` / `approve`                                   |
| Customer credit sale / payment received                                    | `CustomerLedger`               | `create`                                               |
| Stock Transfer create / approve / receive                                  | `StockTransfer`                | `create` / `approve` / `receive`                       |
| POS Session open / close (incl. auto-close on logout, cash reconciliation) | `POSSession`                   | `create` / `close`                                     |
| Ground Balance create / edit / delete                                      | `GroundBalance`                | `create` / `edit` / `delete`                           |
| Expiry write-off                                                           | `Item`                         | `write_off`                                            |
| Product price change                                                       | `Product`                      | `price_change` (mirrors `Product_Price_History`)       |
| Promotion create / activate (incl. AI-suggested activation)                | `Promotion`                    | `create` / `activate`                                  |
| Bulk import commit                                                         | `Product` (or relevant entity) | `bulk_import` — **one summary entry**, not one per row |
| Failed login attempt                                                       | `Auth`                         | `login_failed`                                         |

`IpAddress` must be populated from the request on **every** entry — this was never populated in the legacy system; do not repeat that gap. Audit writes happen inside the **same DB transaction** as the mutation wherever possible.

> Immutability: no edit/delete API for audit logs. Admin read-only.

---

## 11. Session, Cart & Counter Rules

- **Persisted cart, not `localStorage`/in-memory session:** cart state lives in a DB `Cart` table (keyed by `pos_session_id`) or Redis, so multi-tab, multi-device, and offline-sync scenarios all work correctly — this directly fixes the legacy system's in-memory-session limitation.
- `CartItem = {productId, itemId, productName, quantity, unitPrice, appliedPromotionId?, taxRateApplied, totalPrice}`.
- `GetCart` math: `subtotal = Σ total`, promotion evaluation (§4 Rule 6), per-line tax, `total = subtotal − discount + tax`, `itemCount = Σ qty`.
- Counter exclusivity: an `active` counter with an `active` session cannot be selected by another user (same rule as legacy, now scoped per branch).
- **POS Session now also carries cash reconciliation state** (`opening_cash`, `expected_closing_cash`, `actual_closing_cash`, `cash_difference`) — see §4 Rule 20.
- **Offline mode addition:** when connectivity drops, cart operations continue writing to IndexedDB; on reconnect, a background sync job replays queued mutations against the server cart, then triggers `POST /api/pos/checkout/sync` for any completed-offline sales.

---

## 12. Reports Specification

1. **Sales report** (`/reports/sales`): date range (default today, end inclusive), optional branch/cashier/counter → sales list + `{totalSales, totalAmount, totalItems}`.
2. **Session report**: `{session, sales, totalSales, totalAmount, totalItems, cashReconciliation}`.
3. **Cash Reconciliation report** _(new)_: per cashier/branch/date range, `cash_difference` trend — a fraud/error signal when repeated shortages appear for one cashier.
4. **Inventory valuation**: over batches with `current_stock_quantity > 0`, grouped by Category (optionally per branch): `{totalStock, costValue, potentialRevenue, profit}` + grand totals.
5. **Profit margin report**: per product/category over a date range, `(selling_price − purchase_price) × units_sold`, ranked.
6. **Accounts Payable report** _(new)_: outstanding balance per supplier; aging buckets (0–30 / 31–60 / 60+ days unpaid).
7. **Accounts Receivable report** _(new)_: outstanding balance per customer; customers near their `credit_limit` flagged.
8. **Low stock** (dashboard + `/stock?lowStock=true`): batches where `current_stock_quantity <= Products.reorder_threshold`.
9. **Expiry counts**: expired vs expiring-soon counts per threshold.
10. **Today sales** (cashier): `sale_date >= today AND < tomorrow` for the current cashier.
11. **Supplier performance report**: on-time delivery rate, PO fulfillment rate, from `Supplier_Delivery`.
12. **AI dashboards** (from AI Processor via SSE): Demand Forecast chart, Market Basket association rules, RFM segment distribution.

---

## 13. Seed Data

1. Roles: `admin`, `inventory`, `cashier`.
2. Branches: `Main Branch (YGN)` — at least one branch must exist before any other seed data; `cash_discrepancy_threshold = 1000`, `rounding_unit = 50`.
3. Users: `admin1/Admin@123` (2FA enrollment prompted on first login), `inventory1/Inventory@123`, `cashier1/Cashier@123` — all scoped to the seed branch.
4. Counters (per branch, if empty): `Counter 1 / Main Entrance`, `Counter 2 / Back Entrance` — both `active`.
5. Categories/Units: at least one of each with a valid `short_name` (needed for barcode generation to work at all) and a default `tax_rate = 5.00`.
6. Permission defaults: `discount.approve = false`, `refund.approve = false`, `void.approve = false`, `credit_sale.approve = false` for `cashier`; `transfer.approve = true`, `supplier_return.confirm = false` for `inventory`.
7. Seed script (Drizzle) must be **idempotent** (upserts).

---

## 14. Security, Notifications, Backup & Localization

### 14.1 Security Hardening

- **Login rate-limiting:** max 5 failed attempts per username per 15 minutes → temporary lockout (`429`); tracked via a Redis counter (reuses existing infrastructure rather than adding a new table).
- **Admin 2FA:** TOTP-based (e.g. `otplib`), **required** for the `admin` role, optional for others; enforced in the NextAuth credentials callback.
- **Session timeout:** idle timeout (8h, matching the legacy system) + an absolute maximum session length; forces re-login after either is exceeded.
- **Card data handling:** never store a raw card number or CVV anywhere — only the masked `**** **** **** LAST4` form (§4 Rule 7). If real card processing is added later, integrate a PCI-compliant payment gateway rather than handling raw PANs in application code.
- Failed login attempts are written to `AuditLog` (`entityType = Auth`, `action = login_failed`) — the legacy system never did this.

### 14.2 Multi-Channel Notifications — Telegram

`Notification.channel` (`in_app` / `telegram`) and `Notification_Subscription` (§3.3) implement this. Setup and delivery flow is in §6.14. Delivery reuses the `ai-processors` Celery worker (`notifications.py` task) to push the same message via the Telegram Bot HTTP API, rather than standing up a separate notification service.

### 14.3 Backup & Disaster Recovery

- Enable **Point-in-Time Recovery (PITR)** on the Neon PostgreSQL project; document the actual retention window for the chosen plan (varies by tier — verify at setup time).
- Nightly `pg_dump` exported to S3-compatible object storage as an independent off-platform backup, retained 30 days.
- **Offline-mode data-loss mitigation:** IndexedDB-queued sales are the one place data could be lost before ever reaching the server (e.g. a tablet crashes before sync). Mitigate by (a) mirroring the queued-sale log to a second local store as redundancy, and (b) giving the cashier a visible "pending sync" counter so an un-synced backlog is never silently invisible.
- Explicit targets: **RPO ≤ 1 hour** (via PITR), **RTO ≤ 4 hours** — revisit once actual hosting/infra is finalized.

### 14.4 Localization & Currency Rounding

- UI language toggle: Myanmar (`my`, default) / English (`en`) via an i18n library (e.g. `next-intl`).
- Calendar: all storage remains Gregorian/UTC (§4 Rule 24); Myanmar-era labels or holiday awareness (e.g. Thingyan) are a **display-layer** concern only, useful for scheduling seasonal Promotions.
- **Currency rounding:** implemented per §4 Rule 25 — `Branch.rounding_unit` (default 50 Ks), `Sale.rounding_adjustment` stores the delta explicitly.

### 14.5 Bulk Data Import

CSV/Excel import for Products, Suppliers, Categories, and opening stock — full flow in §6.13, endpoints in §7.3.

---

## 15. Migration Notes (Legacy C# → Next.js + AI)

1. **Routeless → routed:** legacy used conventional MVC routing; Next.js needs explicit `app/` routes (§8) + `middleware.ts` role/permission guards. Fix the legacy's unauthenticated actions with default-deny (§2).
2. **Session cart → persisted cart:** see §11 — this also fixes the legacy system's serverless/multi-device incompatibility, and is a prerequisite for Offline Mode.
3. **GET-mutations → proper verbs:** the legacy `Expiry/WriteOff` was a GET; in SmartRetailAI it must be `POST /api/expiry/:id/write-off`.
4. **Local time → UTC:** the legacy system stored server-local `DateTime.Now`. SmartRetailAI stores UTC everywhere and renders in branch timezone.
5. **Decimal precision:** all money columns `decimal(12,2)`; JS-side money math via `decimal.js`, round tax to 2dp before the final currency-rounding step (§4 Rule 25).
6. **Single-branch → multi-branch:** every legacy formula (PO status, low-stock, checkout, session exclusivity) has been re-scoped with a `branch_id` dimension in this plan — the single biggest structural change from the legacy system (see §16 for how this is staged).
7. **No AI → AI Layer:** RAG, Forecasting, Promotion suggestion, RFM did not exist in the legacy system; they are additive and communicate via Redis Streams + SSE (Proposal §6.3), not part of the core transactional path — a Redis/AI outage must **never** block POS checkout.
8. **No financial layer → ERP layer:** Accounts Payable/Receivable, Tax-per-category, Cash Reconciliation, UOM Conversion, Return-to-Supplier, Void Sale, and Price History (§3.3, §4) are entirely new — greenfield additions with no legacy behavior to preserve, designed fresh against real minimart operating needs.
9. **Dangerous hard-delete:** the legacy `Supplier/Delete` performed a hard cascade destroying purchase history. SmartRetailAI defaults to soft-delete (§3.1) — a deliberate behavior change, not a straight port.
10. **Ground Balance & POS Session:** both existed in the legacy system but were initially missing from the Proposal — now restored in full (§3.2) since they are core operational features, not optional extras.
11. **Barcode/ItemCode generation:** the legacy dead code (`GenerateBarcode()`, producing an unused `CM-...` format) is **not** ported — only the live, actually-used format is implemented (§4 Rule 1).

---

## 16. Single-Branch-First Implementation Strategy

**Decision:** build and launch for **one shop only** first, then unlock multi-branch operation later — without a schema rewrite when that day comes.

**Core principle:** _"Design branch-ready, launch single-tenant."_ Every table and query is written as if multiple branches already exist, even though the seed data contains exactly one. This costs almost nothing extra now (one FK column, one `WHERE` clause) but avoids an expensive retrofit later — adding `branch_id` to an already-live system means backfilling every row, rewriting every query, and converting single-column unique constraints into composite ones. Doing it up front is far cheaper than doing it after go-live.

### 16.1 What to build branch-ready from Day 1

| Layer                        | Phase 0–12 (this shop only)                                                                                                                                                                                             | Phase 13 (multi-branch unlock)                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DB Schema**                | `branch_id` FK on every relevant table (`Products`, `Items`, `Purchase_Order`, `GRN`, `Sale`, `POS_Session`, `Counter`, `Ground_Balance`, `Users`, …) from the very first migration. Seed exactly **one** `Branch` row. | Insert additional `Branch` rows only — **no schema migration required.**                                                                              |
| **Numbering**                | Number formats (§5) already embed `{branchCode}` — use a fixed code (e.g. `MAIN`) from day 1.                                                                                                                           | Assign a real code per new branch; format logic is unchanged.                                                                                         |
| **Query / Repository layer** | Every query goes through a single `getCurrentBranchId()` helper and filters `WHERE branch_id = :currentBranchId` — even though the result is always the same one branch.                                                | Update `getCurrentBranchId()` to read from a session/branch-switcher instead of returning the hardcoded seed branch. No other business logic changes. |
| **Auth / Session**           | `Users.branch_id` exists in the schema and is set on the (single) seed user.                                                                                                                                            | Branch dropdown added to the staff-creation form.                                                                                                     |
| **Reports**                  | Every report query includes a `branch_id` filter/`GROUP BY`, even though it only ever returns one branch's data.                                                                                                        | Aggregation across branches becomes a matter of removing the single-branch filter, not restructuring the query.                                       |

### 16.2 What to defer until Phase 13 (genuinely needs 2+ branches)

- **Stock Transfer** feature (UI + approve/receive business logic) — meaningless with one branch.
- **Multi-branch Admin Dashboard** (branch comparison view).
- **Branch Switcher** UI component (header dropdown) — hidden entirely while `branches.length === 1`.
- **Cross-branch reporting** (e.g. "sales by branch" comparison charts).

### 16.3 Code Pattern — Branch Context Helper

```typescript
// lib/branch-context.ts
export async function getCurrentBranchId(session: Session): Promise<string> {
  // Phase 0–12: always returns the single seeded branch's id
  // Phase 13: extend this to read an active-branch selection from
  //  the session/cookie once a Branch Switcher exists — no caller changes.
  return session.user.branchId;
}
```

```typescript
// app/api/products/route.ts — written the same way regardless of branch count
export async function GET(req: Request) {
  const branchId = await getCurrentBranchId(session);
  const products = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.branchId, branchId)); // always branch-scoped, by habit
  return Response.json(products);
}
```

### 16.4 Explicit Rule for Every PR During Phase 0–12

> **No table is created without a `branch_id` column (unless it is genuinely global, e.g. `Permission` role-defaults or `AuditLog`), and no list/report query is written without a branch filter — even when there is only one branch to filter by.**

This single rule is what makes Phase 13 a feature-addition phase instead of a migration project.

---

## 17. Implementation Phases

> **Branch Scope** column: 🏪 = built and tested against a **single seeded branch**. 🏬 = genuinely requires **2+ branches**, deferred to Phase 13 (§16).

| Phase | Scope                                                                                                                                                                                                                         | Branch | Exit Criteria                                                                                                                                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Repo scaffold (per `PROJECT_SETUP_PLAN.md`) + Drizzle schema incl. §3 fixes/additions (every table carries `branch_id` per §16) + seed (1 branch) + auth + middleware guards + PITR enabled (§14.3)                           | 🏪     | login/logout + role redirects work; seeds idempotent                                                                                                                                                                                     |
| 1     | Master data (Branch, Category incl. tax rate, Unit, Product incl. UOM Conversion, Supplier, Customer, Counter) + audit viewer                                                                                                 | 🏪     | CRUD + soft-delete + audit entries verified; every query goes through the branch-context helper (§16)                                                                                                                                    |
| 2     | PO + GRN + Stock views (incl. `Items` live-quantity + UOM conversion fix) + Accounts Payable (Supplier Payment) + Price History trigger                                                                                       | 🏪     | PO→GRN→stock-increase round-trip in correct sale-unit quantities; status recompute tested; supplier payment status recomputes correctly                                                                                                  |
| 3     | Expiry + Reorder + Ground Balance + Return-to-Supplier (Debit Note)                                                                                                                                                           | 🏪     | write-off zeroes stock; reorder creates PO; stock-take differences correct; debit note reduces stock + supplier balance correctly                                                                                                        |
| 4     | POS (counter→**session** incl. cash reconciliation→terminal→cart→checkout with per-line tax→close) + Accounts Receivable (credit sale) + Void Sale                                                                            | 🏪     | concurrent-counter exclusion, FEFO, transaction rollback on low stock, receipt print; session close enforces cash count + flags discrepancy; credit sale updates customer ledger and respects credit limit; void restores stock same-day |
| 5     | Sale Return/Refund + Promotion Engine (manual + bundle + seasonal)                                                                                                                                                            | 🏪     | return restores stock; promotion discounts compute correctly at checkout                                                                                                                                                                 |
| 6     | Offline Mode (PWA + persisted cart + sync reconciliation)                                                                                                                                                                     | 🏪     | offline sale queues, syncs, and conflict-flags correctly on reconnect                                                                                                                                                                    |
| 7     | Reports (sales, session, valuation, profit margin, cash reconciliation, AP, AR, supplier performance) + Audit Log viewer                                                                                                      | 🏪     | numbers reconcile with POS transactions                                                                                                                                                                                                  |
| 8     | AI Microservice setup (FastAPI + Redis Streams + Celery + SSE)                                                                                                                                                                | 🏪     | `/health` check passes; job dispatch + SSE relay round-trip works                                                                                                                                                                        |
| 9     | RAG Text-to-SQL integration                                                                                                                                                                                                   | 🏪     | chat query returns correct answer against seed data                                                                                                                                                                                      |
| 10    | Market Trend, Market Basket + AI-Suggested Promotion (draft→admin-activate)                                                                                                                                                   | 🏪     | AI suggestion never auto-activates; admin approval gate enforced                                                                                                                                                                         |
| 11    | Demand Forecasting + Price Optimization + RFM Segmentation                                                                                                                                                                    | 🏪     | forecast/RFM dashboards populated from real sales history                                                                                                                                                                                |
| 12    | Hardening: UTC audit, money rounding, pagination, rate-limit login, IP audit population, Security Hardening (2FA, session timeout, login lockout), full test suite (Vitest + Playwright + pytest per `PROJECT_SETUP_PLAN.md`) | 🏪     | gate pass, UAT with seed accounts across all 3 roles — **single-branch product is launch-ready at this point**                                                                                                                           |
| 13    | **Multi-Branch Unlock** (§16): seed 2nd branch, Stock Transfer feature, Branch Switcher UI, Multi-branch Admin Dashboard, cross-branch reporting                                                                              | 🏬     | 2nd branch onboarded with zero schema migration; transfer moves stock correctly between branches; dashboard aggregates across branches                                                                                                   |
| 14    | ERP Operational Extensions: Bulk Data Import, Telegram Notification channel, off-platform backup automation, Localization (my/en toggle)                                                                                      | 🏪     | product/supplier CSV import round-trips with validation errors shown; Telegram alerts arrive for low-stock/expiry/cash-discrepancy; nightly backup verified restorable; UI toggles my/en correctly                                       |

---

_End of PROJECT_PLAN.md — the complete, gap-filled build contract for the SmartRetailAI Next.js + ERP + AI rewrite._
