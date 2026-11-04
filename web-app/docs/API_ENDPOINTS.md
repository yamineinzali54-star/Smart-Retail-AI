# API Endpoints

~150 routes under `app/api`. Conventions: JSON `{ ok: true, ... }` responses,
`?page=` / `?pageSize=` pagination (default 20, max 100), branch scoping via
`session.user.branchId` on every list/detail query, audit entries with client IP
on all mutations. Roles: **A**dmin, **I**nventory, **C**asher. `P` = extra
`hasPermission()` gate (`lib/permissions.ts`).

## Auth (`/api/auth`) — public + session-owned

| Route                     | Methods | Who     | Notes                                                                  |
| ------------------------- | ------- | ------- | ---------------------------------------------------------------------- |
| `/api/auth/login`         | POST    | public  | Credentials-first; `TOTP_REQUIRED` if enrolled; cashier PIN login      |
| `/api/auth/logout`        | POST    | session | Revokes **all** sessions, not just cookie                              |
| `/api/auth/refresh`       | POST    | session | Rotating refresh (1h access / 7d refresh); reuse detection revokes all |
| `/api/auth/session`       | GET     | session | Current session for `PageShell` / `usePageSession`                     |
| `/api/auth/branches`      | GET     | session | Branches assigned to user (`user_branch`)                              |
| `/api/auth/switch-branch` | POST    | session | Persists `branch_id`, revokes all sessions                             |
| `/api/auth/totp/setup`    | POST    | session | Returns otpauth URL (opt-in 2FA)                                       |
| `/api/auth/totp/confirm`  | POST    | session | Verify code, enable 2FA                                                |
| `/api/auth/totp/disable`  | POST    | session | Requires password                                                      |

## Self-service (`/api/settings`) — any authenticated user

| Route                                                         | Methods        | Notes                                |
| ------------------------------------------------------------- | -------------- | ------------------------------------ |
| `/api/settings/profile`                                       | GET, POST      | fullName, email                      |
| `/api/settings/password`                                      | POST           | current + new + confirm              |
| `/api/settings/notifications`                                 | POST           | list/link notification subscriptions |
| `/api/settings/notifications/link`                            | POST           | link device                          |
| `/api/settings/notifications/link-code`                       | GET            | pairing code                         |
| `/api/notifications`                                          | GET, PATCH     | own-branch inbox, mark read          |
| `/api/admin/settings/profile`, `/api/admin/settings/password` | GET/POST, POST | legacy aliases, same behavior        |

## Master data (`/api/admin/*`) — A+I (except staff/branches/counters: A only)

| Route                                                     | Methods                            | Who   | Notes                                             |
| --------------------------------------------------------- | ---------------------------------- | ----- | ------------------------------------------------- |
| `categories`, `categories/[id]`                           | GET, POST / GET, PATCH, DELETE     | A+I   | Tax rate lives on category; soft-delete           |
| `categories/import`, `.../template`                       | POST / GET                         | A+I   | Bulk import preview → commit (one txn)            |
| `units`, `units/[id]`                                     | GET, POST / GET, PATCH, DELETE     | A+I   | Sale/purchase units; UOM conversions              |
| `products`, `products/[id]`                               | GET, POST / GET, PATCH             | A+I   | UOM conversions and price history                 |
| `products/[id]/uom-conversion`                            | GET, POST                          | A+I   | Purchase→sale unit factors                        |
| `products/import`, `.../template`                         | POST / GET                         | A+I   | Bulk import                                       |
| `suppliers`, `suppliers/[id]`                             | GET, POST / GET, PATCH             | A+I   | Payable derived from GRN − payments               |
| `suppliers/import`, `.../template`                        | POST / GET                         | A+I   | Bulk import                                       |
| `staff`, `staff/[id]`, `staff/[id]/branches`              | GET, POST / GET, PATCH / GET, POST | **A** | User admin: create, deactivate, branch assignment |
| `employees`, `employees/[id]`, `employees/[id]/activity`  | same                               | **A** | Legacy alias of staff                             |
| `branches`, `branches/[id]` (+ top-level `/api/branches`) | GET, POST / GET, PATCH             | **A** | Single-branch-first; YGN seeded                   |
| `counters`, `counters/[id]`                               | GET, POST / GET, PATCH             | **A** | One active POS session per counter                |

## Purchasing — A+I (approval: A only)

| Route                                        | Methods                | Who   | Notes                                                              |
| -------------------------------------------- | ---------------------- | ----- | ------------------------------------------------------------------ |
| `purchase-orders`                            | GET, POST              | A+I   | Decimal totals, numbering w/ collision retry                       |
| `purchase-orders/[id]`                       | GET, PATCH             | A+I   | Edit draft only                                                    |
| `purchase-orders/[id]/approve`, `.../reject` | POST                   | **A** | Approval gate; GRN 409s on unapproved PO                           |
| `purchase-orders/lookups`                    | GET                    | A+I   | Suppliers + products picker data                                   |
| `grn`                                        | GET, POST              | A+I   | UOM conversion at confirm; updates batch cost                      |
| `grn/[id]`, `grn/by-po/[poId]`               | GET                    | A+I   | Detail; receive against a PO                                       |
| `supplier-payments`                          | GET, POST              | A+I   | `payment_status` recompute; OVERPAYMENT warn                       |
| `supplier-returns`, `supplier-returns/[id]`  | GET, POST / GET, PATCH | A+I   | Draft → **confirm needs `supplier_return.confirm`** (A by default) |

## Inventory — A+I (transfer approve: permission-gated)

| Route                                        | Methods                | Who | Notes                                                                                       |
| -------------------------------------------- | ---------------------- | --- | ------------------------------------------------------------------------------------------- |
| `stock`                                      | GET                    | A+I | Batch-level balances, branch-scoped                                                         |
| `stock/[itemId]`                             | GET, PATCH             | A+I | PATCH = price-history hook                                                                  |
| `expiry`                                     | GET                    | A+I | Expiry buckets (expired / near-expiry)                                                      |
| `expiry/[itemId]/write-off`                  | POST                   | A+I | Damaged/expired write-off + GL post                                                         |
| `expiry/reorder`                             | POST                   | A+I | Raise PO from reorder list                                                                  |
| `ground-balance`, `ground-balance/[batchNo]` | GET, POST / GET        | A+I | Physical count entry (count-only)                                                           |
| `stock-transfers`, `stock-transfers/[id]`    | GET, POST / GET, PATCH | A+I | pending→approved→in_transit→received; **approve needs `transfer.approve`** (A+I by default) |
| `stock-adjustments`                          | GET, POST              | A+I | Damage/loss/found/correction, posts immediately + audit                                     |

## POS (`/api/pos`, `/api/pos-sessions`) — A+C

| Route                                            | Methods                  | Who | Notes                                                                                         |
| ------------------------------------------------ | ------------------------ | --- | --------------------------------------------------------------------------------------------- |
| `pos-sessions/select`                            | GET, POST                | A+C | Open/select session; one active per counter                                                   |
| `pos-sessions/current`                           | GET                      | A+C | Active session for terminal                                                                   |
| `pos-sessions/[id]/report`, `.../close`          | GET / POST               | A+C | X-report; close w/ cash reconciliation                                                        |
| `pos/products/search`, `pos/products/[id]/stock` | GET                      | A+C | FEFO-aware availability                                                                       |
| `pos/cart`                                       | GET, POST, PATCH, DELETE | A+C | DB-backed cart per session                                                                    |
| `pos/cart/park`, `.../resume`, `.../parked`      | POST / POST / GET        | A+C | Parked (suspended) sales                                                                      |
| `pos/checkout`                                   | POST **P**               | A+C | Promos/tax/rounding; tenders cash/card-last4/mobile; manual discount needs `discount.approve` |
| `pos/checkout/sync`                              | POST                     | A+C | Offline queue replay (idempotent)                                                             |
| `pos/sales/[id]`, `pos/sales/[id]/void`          | GET / POST **P**         | A+C | Same-session void free; other-session needs `void.approve`                                    |
| `pos/today-sales`                                | GET                      | A+C | Session-scoped day sales                                                                      |
| `pos/handovers`                                  | GET, POST                | A+C | Blind-count shift handover, session stays open                                                |

> Hardware printing removed: `pos/cash-drawer/open`, `pos/print`, `pos/printers/default`, `admin/printers`, `admin/print-jobs`, `/api/print-agent/*` no longer exist. Receipts = on-screen preview + QR e-receipt.

## Sale returns (`/api/sale-returns`) — A+C, approve: A-gated

| Route                       | Methods         | Who | Notes                                                          |
| --------------------------- | --------------- | --- | -------------------------------------------------------------- |
| `sale-returns`              | GET, POST **P** | A+C | Without `refund.approve` the return queues pending             |
| `sale-returns/[id]/approve` | POST **P**      | A+C | Resolution restock/damage (damage never restocks); cash refund |

## Money operations — A-only

| Route                | Methods          | Who   | Notes                                      |
| -------------------- | ---------------- | ----- | ------------------------------------------ |
| `expenses`           | GET, POST        | **A** | Operational expenses + GL post             |
| `expense-categories` | GET, POST        | **A** | Category master data                       |
| `expense-budgets`    | GET, POST        | **A** | Monthly limits; overruns warn, never block |
| `petty-cash/floats`  | GET, POST, PATCH | **A** | Imprest floats; issued vs spent + returned |

## GL (`/api/admin/gl`) — A only

| Route                             | Methods                | Notes                                               |
| --------------------------------- | ---------------------- | --------------------------------------------------- |
| `gl/accounts`, `gl/accounts/[id]` | GET, POST / GET, PATCH | Global COA (13 seeded accounts)                     |
| `gl/manual-journals`              | GET, POST              | Balanced manual entries (debits = credits enforced) |
| `gl/trial-balance`                | GET                    | Debit/credit totals + balance check                 |
| `gl/ledger`                       | GET                    | Account ledger w/ branch + date filters             |
| `gl/opening-balances`             | POST                   | Opening balance intake                              |

Auto-posting (via `lib/gl.ts` `postJournal`, executor-injected) fires in:
checkout, GRN confirm, supplier payments, expenses, sale returns,
voids, stock adjustments/write-offs.

## Promotions (`/api/admin/promotions`) — A only

| Route             | Methods                                    | Notes                                                        |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------ |
| `promotions`      | GET, POST                                  | Manual promotions (percent / fixed / BxGy)                   |
| `promotions/[id]` | GET, PATCH, DELETE (+ activate/deactivate) | Product links; checkout/cart consume via `computeCartTotals` |

## Reports (`/api/admin/reports`) — A only, all branch-filtered

`sales`, `profit-margin`, `profit-loss`, `inventory-valuation`,
`inventory-aging`, `inventory-abc`, `cash-reconciliation`,
`cashier-performance`, `hourly-sales`, `accounts-payable`,
`supplier-performance`, `tax` (+ `?detail=true` IRD
e-invoice export), `expense-budget`, `attendance`, `z-report` — all GET.

## Ops / infra

| Route                                       | Methods                | Who    | Notes                                                   |
| ------------------------------------------- | ---------------------- | ------ | ------------------------------------------------------- |
| `admin/permissions`                         | GET, PATCH             | **A**  | Per-role action overrides; admin always allowed         |
| `admin/audit-logs`, `admin/audit-logs/[id]` | GET                    | **A**  | Append-only viewer                                      |
| `admin/backup`                              | GET                    | **A**  | Off-platform JSON snapshot (audit-logged)               |
| `admin/backup/restore`                      | POST                   | **A**  | Restore from snapshot                                   |
| `admin/cron`                                | GET, POST, DELETE      | **A**  | pg_cron job management UI backend                       |
| `/api/cron/alerts`                          | GET                    | secret | `CRON_SECRET`; scans all branches; `/cron` UI for admin |
| `admin/notifications/scan`                  | POST                   | A+I    | Trigger alert scan for branch                           |
| `admin/shift-rosters`, `.../[id]`           | GET, POST / GET, PATCH | **A**  | Planned shifts vs POS sessions (15-min grace)           |

## Public (no session — field-allowlisted, read-only)

| Route                                            | Methods | Notes                                          |
| ------------------------------------------------ | ------- | ---------------------------------------------- |
| `/api/public/receipts/[saleNumber]`              | GET     | Legacy e-receipt (`/r/[saleNumber]`)           |
| `/api/public/display/[branchCode]`               | GET     | Counter display (`/display/`)                  |
| `/login`, `/manifest.webmanifest`, `/api/auth/*` | —       | Proxy allowlist (`proxy.ts` default-deny gate) |
