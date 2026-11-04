# Database Migrations

Engine: `drizzle-kit` (PostgreSQL dialect, journal v7). Target: Neon Postgres.
Scripts: `npm run db:generate` (diff) · `npm run db:migrate` (apply journal) ·
`npm run db:seed` (idempotent seed via `tsx db/seed.ts`).

## Two-track system

| Track            | Files                                                                                             | Applied by                          | Journal                       |
| ---------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------- |
| Journaled schema | `0000_*` … `0015_*`                                                                               | `npm run db:migrate`                | `meta/_journal.json` idx 0–15 |
| Manual RLS       | `0004_rls_master_data.sql`, `0005_rls_immutable_master_data.sql`, `0015_rls_remaining_tables.sql` | `psql -f` by hand, in numeric order | **not** in journal            |

The three `*_rls_*.sql` files are intentionally outside the drizzle journal
(repo convention): RLS needs roles (`authenticated`) and the `auth.jwt()` stub
that plain Neon lacks, so they ship with their own idempotent prerequisite
blocks (`CREATE ROLE IF NOT EXISTS`, `CREATE SCHEMA IF NOT EXISTS`).

## Journaled migrations (idx → tag → content)

| Idx | File                            | Content                                                                                  |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| 0   | `0000_warm_centennial`          | Initial scaffold (Phase 0 tables)                                                        |
| 1   | `0001_bizarre_ken_ellis`        | Schema iteration                                                                         |
| 2   | `0002_striped_silhouette`       | `auth_session` + indexes                                                                 |
| 3   | `0003_add_email_to_users`       | `users.email`                                                                            |
| 4   | `0004_curved_blindfold`         | Schema iteration (pairs with manual RLS below)                                           |
| 5   | `0005_gigantic_wasp`            | Schema iteration (pairs with manual RLS below)                                           |
| 6   | `0006_typical_mandroid`         | Purchasing / stock-flow tables                                                           |
| 7   | `0007_black_wallflower`         | POS + session tables                                                                     |
| 8   | `0008_majestic_spirit`          | Reports/audit support tables                                                             |
| 9   | `0009_sloppy_red_wolf`          | GL (`gl_account`, `journal_entry`, `journal_line`)                                       |
| 10  | `0010_fixed_ares`               | Money extras (vouchers, installments, loyalty)                                           |
| 11  | `0011_heavy_inhumans`           | Petty cash, handovers, printers                                                          |
| 12  | `0012_greedy_sersi`             | Budgets, roster, credit notes                                                            |
| 13  | `0013_green_firebird`           | Wholesale pricing, tax-invoice fields                                                    |
| 14  | `0014_loose_wallow`             | Latest schema iteration                                                                  |
| 15  | `0015_plain_rick_jones`         | `app_setting` key/value store (Telegram admin controls)                                  |
| 22  | `0022_remove_customer_features` | Removes customer profiles, linked tenders/features, ledgers and customer AI segmentation |

Each has a full snapshot in `meta/<idx>_snapshot.json` (used by `db:generate`
for diffing, not by `migrate`).

## Manual RLS migrations (apply after `db:migrate`)

```bash
psql "$DATABASE_URL" -f db/migrations/0004_rls_master_data.sql
psql "$DATABASE_URL" -f db/migrations/0005_rls_immutable_master_data.sql
psql "$DATABASE_URL" -f db/migrations/0015_rls_remaining_tables.sql
```

| File                                 | Covers                                                                                                               | Pattern                                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `0004_rls_master_data.sql`           | `category`, `unit`, `products`, `suppliers`, `branch`, `users` + `is_admin()` helper                                 | SELECT open · writes admin-only                                                                                              |
| `0005_rls_immutable_master_data.sql` | `audit_log` append-only; no-hard-delete on master data                                                               | INSERT + SELECT only · explicit deny UPDATE/DELETE                                                                           |
| `0015_rls_remaining_tables.sql`      | Remaining 50 tables at the time of creation (POS, purchasing, inventory, GL + `app_setting`; printer tables removed) | Same as 0004; ledgers and `product_price_history` INSERT-only; `auth_session` SELECT admin-only (hides refresh-token hashes) |

Truth-in-advertising: the app connects as table owner, so RLS never fires for
app traffic — real enforcement is the API route guards + `PageShell` UI map.
RLS protects direct non-owner access (psql, BI tools) only. `auth.jwt()` is a
NULL stub on plain Neon, so `is_admin()` is false for every non-owner
connection: reads allowed, writes denied.

## Seed (`db/seed.ts`, idempotent — safe to re-run)

- Exactly **one** branch: `YGN` / Main Branch (single-branch-first, §16)
- **3 users** (bcrypt-hashed): `admin1` / `Admin@123`, `inventory1` /
  `Inventory@123`, `cashier1` / `Cashier@123`
- **2 counters**, 13-account chart of accounts, default permission rows
  (see `lib/permissions.ts` DEFAULTS)

## Conventions for new migrations

- New tables get `branch_id` FK, except global `permission` / `audit_log`.
- Money columns: `numeric(12,2)`; timestamps: UTC `timestamptz`.
- Schema change → `npm run db:generate` (adds journal entry + snapshot).
- RLS for the new table → append a block to the matching manual file pattern
  (or a new `NNNN_rls_*.sql`), following the SELECT-open / writes-admin-only
  convention; ledgers get INSERT-only.
- Test-database isolation: `.env.test` `TEST_DATABASE_URL` transparently
  replaces `DATABASE_URL` inside suites; integration tests cover the migration
  contract + seed idempotency.
