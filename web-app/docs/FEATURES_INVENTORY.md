# Inventory Features (`inventory1`)

Stock-and-purchasing workspace. Lands on `/inventory` (low-stock,
expiry, reorder KPIs). **No POS terminal, no finance, no staff admin.**
Sidebar: stock/expiry/PO/GRN/ground-balance/transfers/adjustments/
supplier-returns/products/categories/units/suppliers + bulk-import
only. Server `PageShell` guard map + API guards enforce the same boundary.

## Master data (CRUD)

- Products (UOM conversions, price-history view), categories (tax rates),
  units, suppliers
- Bulk import with preview → commit for products, suppliers, categories
  (`/bulk-import`)

## Purchasing flow

1. Create PO (`/purchase-orders/new`) — draft, editable, Decimal totals
2. Wait for **Admin approval** (cannot approve/reject — 403)
3. Receive GRN (`/grn`, `/grn/by-po/[poId]`) — UOM conversion at confirm,
   batch cost updated, PO status recomputed
4. Record supplier payments — `payment_status` recomputed, OVERPAYMENT warns
5. Supplier returns: create drafts; **confirm needs `supplier_return.confirm`**
   (Admin-only by default — drafts queue for Admin)

## Stock flows

- Batch-level stock list + detail, barcode-label preview (`/stock`)
- Expiry buckets → write-off (damaged/expired, GL-posted) or raise reorder PO
- Ground-balance physical counts (`/ground-balance`)
- Stock transfers: create + receive; **approve needs `transfer.approve`**
  (granted to inventory by default — the one approval inventory holds)
- Stock adjustments (damage/loss/found/correction — posts immediately + audit)

## Explicitly blocked (403 + UI-hidden)

POS terminal, cart, checkout, sessions, handovers (A+C only) · promotions,
expenses, budgets, GL, petty cash, staff/branches/counters,
permissions, audit logs, backup, roster, cron, all `/reports/*` ·
PO approve/reject · void/refund/discount approvals.

## Notes

- Everything is branch-scoped to the session branch; switching branches
  revokes all sessions.
- Writes that post to GL (GRN, adjustments, write-offs, transfer receipts)
  happen automatically inside the same transaction — no separate step.
