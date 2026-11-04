# Admin Features (`admin1`)

Full access. Workspace: `/dashboard` → `/dashboard/admin` (live revenue KPIs,
low-stock/expiry alerts, branch-scope cards). Sidebar: complete nav (all main
items + all docs) + notifications + settings.

## What only Admin can do

| Area                 | Capabilities                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff & access       | Create/deactivate users, assign branches (`/staff`), manage counters (`/counters`), branch settings (`/branches`), per-role permission overrides (`/permissions` — admin always allowed) |
| Purchasing oversight | Approve/reject purchase orders (`purchase-orders/[id]/approve`, `.../reject`); GRN is blocked (409) on unapproved POs                                                                    |
| Promotions           | Full CRUD + activate/deactivate + product links (`/promotions`)                                                                                                                          |
| Money operations     | Create expenses + categories + budgets, manage petty-cash floats                                                                                                                         |
| GL                   | COA management, manual balanced journals, opening balances, trial balance, ledger                                                                                                        |
| POS supervision      | Open/close any session, void any session, approve queued sale returns + refunds, blind-count handovers, Z-report, cashier-performance report                                             |
| Oversight            | All 16 report pages + session-report API, audit-log viewer, backup export + restore, cron/pg_cron management, shift roster                                                               |

## Permission-gated actions (auto-approved for Admin)

`discount.approve`, `void.approve`, `refund.approve`,
`transfer.approve`, `supplier_return.confirm` — Admin passes `hasPermission()`
unconditionally (`lib/permissions.ts`); overrides for other roles live in the
`permission` table, editable at `/permissions`.

## Admin surfaces

Pages: `/admin` (server-guarded, non-admin redirected), all of
`/reports/*`, `/gl/*`, `/audit-logs`, `/permissions`, `/backup`, `/cron`,
`/petty-cash`, `/staff` (Staff, Roster & Attendance, and Attendance Report tabs),
`/branches`, `/counters`, `/promotions/*`, `/expenses*` (hardware printing
removed — no printer registry, queue, agent, or drawer-kick endpoints).
APIs: every `/api/admin/*` route; `/api/pos/*` and `/api/pos-sessions/*`
(shared with cashier); `/api/cron/alerts` via `CRON_SECRET`.

## Limits / notes

- Branch switching (`/api/auth/switch-branch`) revokes **all** sessions —
  re-login required.
- Backup restore is destructive by nature; every export is audit-logged.
- Manual journals must balance (debits = credits) — enforced in API + `gl-math` tests.
