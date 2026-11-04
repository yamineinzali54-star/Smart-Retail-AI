# Cashier Features (`cashier1`)

Sell-and-close workspace. Lands on `/dashboard/cashier` (today's sales, active
session). Sidebar: dashboard + POS terminal + new sale return + handover only.
**No master data, no purchasing, no stock, no finance, no reports.**

## POS session lifecycle

1. `/pos/select-counter` — pick a counter (one active session per counter)
2. `/pos/terminal` — sell (PIN login supported as password alternative)
3. `/pos/today-sales` — own-session day sales
4. `/pos/handover` — blind-count handover, session stays open
5. `/pos/end-session` — count the till; discrepancies over threshold alert Admin
6. `/pos/receipt/[saleId]` — preview and reprint receipt

## Checkout (`POST /api/pos/checkout`)

- FEFO stock deduction, promotions auto-applied, per-line tax from category,
  Kyat rounding, Decimal math
- Tenders: cash, card (last-4 only — no PAN storage), mobile (provider + txn
  id, unique guard)
- Offline: queue + `/pos/checkout/sync` idempotent replay
- **Needs approval otherwise:** manual discount (`discount.approve`) — denied
  for cashier by default, Admin overrides at `/permissions`

## Voids & returns

- Void own-session sale freely; voiding another session needs `void.approve`
- New sale return (`/pos/sale-returns/new`); without `refund.approve` it queues
  **pending for Admin** — approve resolves restock (batch back) vs damage
  (never restocks), with cash refund
- Park/resume carts for interrupted sales

## Explicitly blocked (403 + UI-hidden)

Everything under `/api/admin/*` except the POS-shared surface · all master
data, purchasing, stock, transfers, suppliers, promotions, expenses, GL,
reports, audit, backup, roster.

## Notes

- Cashier sees only own-branch data. Sales are recorded without customer
  profiles or customer identifiers.
- Receipts are on-screen preview and printable (hardware printing removed).
- Idle timeout (`IDLE_TIMEOUT_SECONDS`, default 30 min) ends stale sessions.
