# Admin User Manual — စီမံခန့်ခွဲသူ (admin1)

> Role: `admin` | Test Account: `admin1 / Admin@123` | Branch: `YGN - Main Branch`
> Workspace: `/dashboard` → auto-redirect → `/admin`
> အခွင့်အရေး: Full access — Master data, Purchasing, Stock, POS, Finance, GL, Reports (16 pages), Staff, Permissions, Audit, Backup, Cron, Roster, AI, Telegram အားလုံး

---

## 0. စမ်းသပ်အချက်အလက် (Test Data) — စတင်မသုံးမီ သိထားရန်

`npm run db:seed` (`db/seed.ts`) ဖြင့် အောက်ပါအချက်အလက်များ အလိုအလျောက် ပါဝင်သည်။ Manual ထဲက နမူနာအားလုံး ဒီ Data ပေါ်အခြေခံသည်။

> **Bulk seed CSVs:** `docs/dataset/` တွင် Myanmar mini-market data အဆင်သင့် — `units.csv` → `categories.csv` → `products.csv` → `suppliers.csv` (bulk import) → `purchase_order_lines.csv` (9 POs, supplier အလိုက်) → `grn_lines.csv` (receive) အစဉ်လိုက် သွင်းပါ။ အသေးစိတ် `docs/dataset/README.md`။
> Customer profiles, customer-linked sales, RFM segments, credit sales, vouchers, credit notes and installments have been removed. POS sales store no customer data.
> **AI စမ်းရန် history လို:** Forecast/Basket/Ops-Alerts သည် sales history ပေါ် တွက်သည် — seed-fresh DB မှာ empty-state ပြမည် (error မဟုတ်)။ UAT script: dataset CSVs သွင်း → PO approve → GRN receive → sale ရက်အလိုက် ရောင်း (7+ ရက်) → AI pages စစ်။

| အမျိုးအစား                        | တန်ဖိုး                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch (တစ်ခုတည်း)                | `YGN` / Main Branch, `cashDiscrepancyThreshold = 1000` Kyat, `roundingUnit = 50` Kyat                                                                                                                                                                                                                                                           |
| Admin account                     | `admin1 / Admin@123`, Full Name: Admin One, `admin1@example.com`                                                                                                                                                                                                                                                                                |
| Inventory account                 | `inventory1 / Inventory@123`                                                                                                                                                                                                                                                                                                                    |
| Cashier account                   | `cashier1 / Cashier@123` (PIN login လည်း ရနိုင် — Staff edit မှာ သတ်မှတ်ပေးရမည်)                                                                                                                                                                                                                                                                |
| Counters (၂ ခု)                   | Counter 1 (Main Entrance), Counter 2 (Back Entrance) — တစ်ခုချင်းစီမှာ active POS session တစ်ခုသာ ဖွင့်နိုင်                                                                                                                                                                                                                                    |
| Category                          | `General` (shortName `G`, tax `5.00%`, taxable)                                                                                                                                                                                                                                                                                                 |
| Unit                              | `Piece` (shortName `PCS`)                                                                                                                                                                                                                                                                                                                       |
| Chart of Accounts (13 ခု, global) | 1000 Cash on Hand (asset), 1010 Bank (asset), 1100 AR (asset), 1200 Inventory (asset), 2000 AP (liability), 2010 Gift Voucher Liability, 2020 Customer Credits, 2100 Tax Payable, 3000 Owner Capital (equity), 4000 Sales Revenue (income), 5000 COGS (expense), 5100 Operating Expenses, 5110 Loyalty & Promotions, 5200 Inventory Adjustments |
| Permission defaults               | `discount.approve` A-only, `refund.approve` A-only, `transfer.approve` A+I, `void.approve` A-only, `supplier_return.confirm` A-only (A=admin; `/permissions` မှာ ပြောင်းနိုင်, admin ကတော့ အမြဲ allowed)                                                                                                                                        |

> ⚠️ သတိ: Branch ချိန်းခြင်း (`/api/auth/switch-branch`) သည် **session အားလုံးကို revoke** လုပ်သည် — ပြန် login ဝင်ရမည်။ Backup restore သည် destructive ဖြစ်သည်။ Manual journal သည် Debit = Credit balance ဖြစ်ရမည်။

---

## 1. Login & Dashboard

### 1.1 `/login` — Login စာမျက်နှာ

- **လုပ်ဆောင်ချက်:** username + password ဖြင့် ဝင်ရောက်ခြင်း။ Admin အတွက် TOTP 2FA enroll လုပ်ထားလျှင် `totpCode` ထပ်တောင်းမည်။
- **Test Data ဖြင့် စမ်းသပ်နည်း:** `admin1` + `Admin@123` ရိုက်ထည့်ပါ → အောင်မြင်လျှင် `/dashboard` → `/admin` သို့ auto-redirect ရောက်မည်။
- **မှားလျှင်:** password မှားလျှင် error ပြမည်။ Session (1h access / 7d refresh) cookie ဖြင့် ထိန်းသည်။

### 1.2 `/admin` — Admin Dashboard (ပင်မစာမျက်နှာ)

- **မြင်ရမည့်အရာ:** `BranchScopeCards` (လက်ရှိ branch — YGN) + `AdminDashboard` — live revenue KPIs (ယနေ့ရောင်းအား, အမြတ်), low-stock/expiry alerts, branch-scope cards။
- **အသုံးပြုပုံ:**
  1. ဝင်ဝင်ချင်း revenue တက်သလား, alert နီပြနေသော ပစ္စည်းရှိသလား ကြည့်ပါ။
  2. Alert ကို click → သက်ဆိုင်ရာ `/stock` / `/expiry` စာမျက်နှာသို့ ရောက်မည်။
  3. Sidebar တွင် item အားလုံး + docs + notifications + settings ပေါ်မည် (အခြား role တွေမှာ အကန့်အသတ်ရှိသည်)။
- **Test Data ဥပမာ:** Seed အသစ်စက်စက်တွင် ရောင်းအား 0 ဖြစ်မည် — Cashier ဖြင့် sale တစ်ခု ရောင်းပြီးမှ KPI တက်လာသည်ကို ပြန်ကြည့်ပါ။

### 1.3 `/dashboard` — Router စာမျက်နှာ

- Admin ဝင်လျှင် `/admin` သို့ အလိုအလျောက် ပို့သည်။ တိုက်ရိုက်ဖွင့်စရာ မလိုပါ။

---

## 2. Staff & Access Control (ဝန်ထမ်းနှင့် ခွင့်ပြုချက်)

### 2.1 `/staff` — ဝန်ထမ်းစာရင်း

- **လုပ်ဆောင်ချက်:** user အားလုံး ကြည့်ခြင်း, active/inactive filter, branch အလိုက် ကြည့်ခြင်း။
- **Test Data:** `admin1`, `inventory1`, `cashier1` သုံးယောက် YGN branch အောက်မှာ ပေါ်မည်။
- **လုပ်ငန်းစဉ်:** စာရင်းထဲက row click → detail/edit; Deactivate → soft-delete (login ဝင်မရတော့, data မပျက်)။

### 2.2 `/staff/new` — ဝန်ထမ်းအသစ် ဖန်တီးခြင်း

- **Fields:** `userName` (unique), `password` (min 8 + upper/lower/digit — ဥပမာ `Staff@1234`), `fullName`, `role` (admin/inventory/cashier), `branchId` (YGN ရွေး), cashier အတွက် fast-PIN (4–6 digits, optional)။
- **စမ်းသပ်နည်း:** Role `cashier`, username `casher2`, password `Cashier@234` ဖြင့် ဖန်တီးပါ (create API တွင် PIN မပါ) → staff detail မှ PIN `1234` သတ်မှတ်ပါ → `/login` မှာ `casher2` + PIN `1234` ဖြင့် terminal login စမ်းပါ။
- **သတိ:** PIN သည် cashier-only; staff edit (PATCH) မှ admin/inventory role အတွက် PIN ထည့်လျှင် `PIN_CASHER_ONLY` (400) error။ Login တွင် cashier မဟုတ်သူ PIN ထည့်လျှင် `401 INVALID_CREDENTIALS` ပြန်သည်။

### 2.3 `/branches` — ဆိုင်ခွဲစီမံခန့်ခွဲမှု

- **လုပ်ဆောင်ချက်:** branch list + create/edit (code/name, `cashDiscrepancyThreshold`, `roundingUnit`)။
- **Test Data:** `YGN / Main Branch` တစ်ခုသာ ရှိသည် (single-branch-first design)။ အသစ်ထည့်လျှင် staff ကို branch assign ပြန်လုပ်ရမည် (`/staff` detail → branch assign, `POST /api/admin/staff/[id]/branches`)။
- **သတိ:** Branch switch လုပ်တိုင်း session အားလုံး revoke — အသုံးပြုသူအားလုံး ပြန် login ဝင်ရမည်။

### 2.4 `/counters` — Counter စီမံခန့်ခွဲမှု

- **လုပ်ဆောင်ချက်:** Counter create/edit/activate-deactivate (name, location, branch)။
- **Test Data:** Counter 1 (Main Entrance), Counter 2 (Back Entrance)။ Counter တစ်ခုတွင် active POS session တစ်ခုသာ ရှိနိုင်သည် — session မပိတ်ဘဲ counter ထပ်ဖွင့်၍ မရ။
- **စမ်းသပ်နည်း:** `Counter 3 (Test)` အသစ်ထည့်ပါ → Cashier `/pos/select-counter` မှာ ရွေးချယ်နိုင်ကြောင်း စစ်ပါ။

### 2.5 `/permissions` — Permission overrides

- **လုပ်ဆောင်ချက်:** Role တစ်ခုချင်းစီအတွက် action 5 ခု (`discount.approve`, `void.approve`, `refund.approve`, `transfer.approve`, `supplier_return.confirm`) ကို on/off။
- **Admin အထူး:** `hasPermission()` တွင် admin အမြဲ `true` — override မလိုပါ။
- **စမ်းသပ်နည်း:** `cashier` + `discount.approve = true` ပေးပါ → Cashier checkout တွင် manual discount ထည့်နိုင်မည်။ ပြီးလျှင် ပြန်ပိတ်ပါ (default false)။
- **API:** `GET/PATCH /api/admin/permissions`။

### 2.6 `/settings/*`, `/my-profile`, `/notifications`

- `/settings/profile` — fullName, email ပြောင်းခြင်း။ `/settings/password` — current + new + confirm (admin1 password `Admin@123` → အသစ်ပြောင်းစမ်းပါ, ပြီးလျှင် ပြန်ထားပါ)။
- `/settings/security` — TOTP 2FA setup/confirm/disable (disable လုပ်ရန် password လိုသည်)။
- `/settings/notifications` — မိမိ alert subscription ကြည့်ခြင်း (in-app inbox + mark-read)။
- `/telegram` — **Telegram group alerts (Admin-only):** Enabled on/off + message language (မြန်မာ / English / နှစ်မျိုး) + `Send test message`။ Bot token + group chat ID က server env (`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — code/DB ထဲ လုံးဝမသိမ်း)။ Covers: daily 8 AM low-stock/expiry scan + session-close cash-discrepancy (threshold ကျော်)။ API: `GET/PATCH /api/admin/settings/telegram`, `POST .../test`။
- ⚠️ **Deprecated:** `/settings/notifications/telegram-setup` (per-user pairing-code link flow) — group model သုံးနေပြီ, ဒီ flow မလိုတော့ပါ (page ရှိနေသေး၏, မသုံးရ)။
- `/notifications` — own-branch inbox, mark-read။

---

## 3. Purchasing Oversight (ဝယ်ယူမှု ကြီးကြပ်ခြင်း)

### 3.1 `/purchase-orders` — PO စာရင်း

- **မြင်ရမည့်အရာ:** PO number, supplier, status (draft/approved/rejected/partially_received/received), totals (Decimal), payment_status။
- **Admin လုပ်နိုင်သည်:** အားလုံး ကြည့်ရန် + approve/reject + draft edit + detail ကြည့်ရန်။

### 3.2 `/purchase-orders/new` — PO အသစ်ဖန်တီးခြင်း

- **လုပ်ငန်းစဉ်:** Supplier ရွေး (Test: supplier အသစ် `/suppliers` မှာ `Test Supplier` ထည့်ပါ) → Product rows ထည့် (Test: General/PCS ပစ္စည်း) → qty + unit price → auto total → Save draft။
- **Numbering:** PO number auto + collision retry။

### 3.3 `/purchase-orders/[id]` — PO Detail + Approve/Reject

- **Admin-only actions (အရေးကြီးဆုံး):**
  - `Approve` → `POST /api/admin/purchase-orders/[id]/approve` — status approved; ထို့နောက် GRN လက်ခံနိုင်။
  - `Reject` → `.../reject` — status rejected; GRN လုံးဝလုပ်မရ။
- **GRN gate:** Unapproved PO ဖြင့် GRN confirm လုပ်လျှင် API က `409` ပြန်မည်။ Inventory က approve လုပ်၍ မရ (403) — Admin သာ လုပ်နိုင်သည်။
- **စမ်းသပ်နည်း:** Inventory1 ဖြင့် PO draft တစ်ခု ဖန်တီးခိုင်း → admin1 ဖြင့် approve → inventory1 GRN ဆက်လုပ်နိုင်ကြောင်း အတည်ပြုပါ။

---

## 4. Stock & Master Data (Admin view — အကုန်ကြည့်နိုင်/ပြင်နိုင်)

Admin သည် Inventory လုပ်သမျှ အကုန်လုပ်နိုင်သည်။ အသေးစိတ်လုပ်ငန်းစဉ်ကို `INVENTORY_MANUAL.md` တွင် ကြည့်ပါ — ဤတွင် Admin 관점 핵심만 요약:

| စာမျက်နှာ                                                             | Admin လုပ်နိုင်ချက် + Test Data ဥပမာ                                                                                                                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/products`, `/products/import`                                       | CRUD + UOM conversion, price-history; bulk import preview→commit။ Test: `Test Noodle 55g` (General, PCS, sale 500) ထည့်ပါ                                                                |
| `/categories`                                                         | Tax rate ပြင်ခြင်း။ Test: General `5.00%` — checkout tax တွက်ပုံ စမ်းရန် `0%` (exempt) category `Test-Exempt` ထည့်စမ်းပါ                                                                 |
| `/units`                                                              | Sale/purchase units + conversion factor။ Test: `BOX (1 BOX = 12 PCS)` conversion ထည့်ပါ                                                                                                  |
| `/suppliers`, `/suppliers/[id]/statement`                             | CRUD + payable (GRN−payments) + statement။ Test: `Test Supplier / 09-xxxxxxx`                                                                                                            |
| `/bulk-import`                                                        | products/suppliers/categories CSV import — preview စစ်ပြီး commit (single txn)                                                                                                           |
| `/grn`, `/grn/new`, `/grn/[id]`, `/grn/by-po/[poId]`                  | GRN confirm (UOM conversion, batch cost update, PO status recompute)။ Test: အထက်က approved PO ဖြင့် GRN လက်ခံပါ                                                                          |
| `/stock`, `/stock/[itemId]`, `/stock/[itemId]/labels`                 | Batch-level balances + barcode-label on-screen preview။ Test: GRN လက်ခံပြီးပစ္စည်း stock တက်လာသည်ကို စစ်ပါ                                                                               |
| `/expiry`                                                             | Expiry buckets (expired/near-expiry) → write-off (damaged/expired, GL-posted) သို့မဟုတ် reorder PO။ Test: expiry နီးပစ္စည်း write-off → GL `5200` entry တက်သည်ကို `/gl/ledger` မှာ စစ်ပါ |
| `/ground-balance`, `/ground-balance/new`, `/ground-balance/[batchNo]` | Physical count entry။ Test: batch တစ်ခု count ရိုက်ထည့်ပါ                                                                                                                                |
| `/stock-transfers`, `/new`, `/[id]`                                   | pending→approved→in_transit→received; approve (`transfer.approve` default A+I)။ Test: YGN→(branch2) transfer စမ်းနိုင်သည်                                                                |
| `/stock-adjustments`                                                  | damage/loss/found/correction — posts immediately + audit။ Test: `damage 2 PCS` adjustment → stock လျော့သွားကြောင်း စစ်ပါ                                                                 |
| `/supplier-returns`, `/new`, `/[id]`                                  | Draft create; confirm (`supplier_return.confirm` A-only)။ Test: draft ဖန်တီး → confirm (admin)                                                                                           |

---

## 5. Promotions (Admin-only)

### 5.1 `/promotions` — စာရင်း

- Manual promotions: percent / fixed / BxGy (buy-X-get-Y), active/inactive, product links။ Cashier checkout/cart တွင် `computeCartTotals` မှတဆင့် auto-apply။

### 5.2 `/promotions/new` — အသစ်ဖန်တီးခြင်း

- **စမ်းသပ်နည်း:** `Test 10% Off` (percent 10, product = Test Noodle, active) ဖန်တီးပါ → Cashier terminal တွင် ထိုပစ္စည်းထည့်လျှင် 10% လျော့သွားကြောင်း စစ်ပါ။

### 5.3 `/promotions/[id]/edit` — ပြင်/activate/deactivate/delete

- Deactivate လုပ်လျှင် checkout တွင် ထပ်မကျတော့ပါ။ API: `GET/POST /api/admin/promotions`, `GET/PATCH/DELETE /[id]` (+ activate/deactivate)။

### 5.4 `/promotions/ai-suggested` — AI Draft Review Queue (§4 Rule 26)

- `/ai/basket` မှ save ထားသော bundle drafts (`status=draft`, `is_ai_suggested=true`, AI badge) စာရင်း — **AI က auto-activate လုံးဝမလုပ်**။
- **လုပ်ငန်းစဉ်:** rule စစ် → `Activate` (checkout တွင် သက်ရောက်ပြီ) သို့မဟုတ် `Discard` (deactivate)။ `/promotions` page မှ "AI suggested" button ဖြင့် ဝင်နိုင်။
- **စမ်းသပ်နည်း:** `/ai/basket` တွင် draft save → ဤတွင်�ေါ် → Activate → terminal တွင် bundle discount ကျမကျ စစ်ပါ။

---

## 6. Money Issuance — Voucher / Credit Note / Expenses / Petty Cash

### 6.3 `/expenses` + `/expenses/budgets` — ကုန်ကျစရိတ်

- `/expenses` (A-only): Operational expenses + auto GL post (5100 Operating Expenses)။ Fields: category, amount, date, note, branch။
- Expense categories master (`GET/POST /api/admin/expense-categories`): Test category `Test-Shop-Use` ထည့်ပါ။
- `/expenses/budgets` (monthly limits): Test: `Test-Shop-Use / 500,000 / month` budget သတ်မှတ်ပါ → overrun လျှင် warn (never block) — report `/reports/expense-budget` တွင် ပေါ်မည်။
- **စမ်းသပ်နည်း:** `10,000 Kyat / Test-Shop-Use` expense တစ်ခု ထည့်ပါ → `/gl/ledger` (5100) + `/reports/profit-loss` တွင် ပါဝင်ကြောင်း စစ်ပါ။

### 6.4 `/petty-cash` — Floats (imprest)

- **လုပ်ဆောင်ချက်:** Floats create/edit — issued vs spent + returned tracking (`GET/POST/PATCH /api/admin/petty-cash/floats`)။
- **စမ်းသပ်နည်း:** `Counter 1 float 200,000` ထုတ်ပါ → spent/returned ပြင်ပြီး balance ကိုက်ကြောင်း စစ်ပါ။

---

## 7. GL — စာရင်းချုပ် (Admin-only)

### 7.1 `/gl/accounts` — Chart of Accounts

- Global COA (13 seeded) list + create/edit (`GET/POST /api/admin/gl/accounts`)။ Test account `6099 Test Expense` ထည့်စမ်းပါ (type expense)။

### 7.2 `/gl/manual-journals` — Manual Journals (Balance enforced)

- **စည်းမျဉ်း:** Debits = Credits ဖြစ်ရမည် — API + `gl-math` tests ဖြင့် enforce။
- **စမ်းသပ်နည်း:** Dr `5100 Operating Expenses 10,000` / Cr `1000 Cash on Hand 10,000` journal တစ်ခု ထည့်ပါ → မညီလျှင် error ပြမည်။ Auto-posting sources: checkout, GRN, payments, expenses, returns, voids, adjustments/write-offs (`lib/gl.ts postJournal`)။

### 7.3 `/gl/trial-balance` — Trial Balance

- Debit/credit totals + balance check (`GET /api/admin/gl/trial-balance`)။ Period ရွေး → totals တူညီကြောင်း (balanced) စစ်ပါ။

### 7.4 `/gl/ledger` — Account Ledger

- Branch + date + account filters။ Test: အထက်က manual journal / expense / GRN entries များ ဤတွင် ပေါ်မပေါ် စစ်ပါ။

### 7.5 `/gl/opening-balances` — Opening Balances

- Intake form (`POST /api/admin/gl/opening-balances`)။ နှစ်စတွင် 1000/1200/3000 စသည့် opening ထည့်ရန်။

---

## 8. POS Supervision (Cashier ကြီးကြပ်ခြင်း)

Admin သည် Cashier terminal လုပ်ငန်းအားလုံး + supervision actions လုပ်နိုင်သည် (`/api/pos/*`, `/api/pos-sessions/*` shared A+C)။

| စာမျက်နှာ                      | လုပ်ဆောင်ချက် + Test Data ဥပမာ                                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/pos` (landing)               | POS hub — session status, shortcuts                                                                                                                                                                                                                                             |
| `/pos/select-counter`          | Counter ရွေး + session open (one active per counter)။ Test: Counter 1 ရွေးပြီး session ဖွင့်ပါ                                                                                                                                                                                  |
| `/pos/terminal`                | Sell — product search (FEFO-aware), cart (DB-backed), promos/tax/rounding auto, cash/card/mobile tenders။ Admin သည် approval-gated actions အကုန် auto-pass (`discount.approve` unconditional)။ Test: Test Noodle 2 ခု + manual discount 500 + cash tender ဖြင့် checkout စမ်းပါ |
| `/pos/today-sales`             | Session-scoped day sales list                                                                                                                                                                                                                                                   |
| `/pos/receipt/[id]`            | Receipt preview/reprint + `/r/[saleNumber]` legacy                                                                                                                                                                                                                              |
| `/pos/handover`                | Blind-count shift handover (session stays open) — လက်ရှိ cashier ထံမှ နောက် shift သို့ လွှဲခြင်း                                                                                                                                                                                |
| `/pos/end-session`             | Till count + close w/ cash reconciliation; threshold (`1000` Kyat default) ကျော် discrepancy လျှင် Admin alert။ Test: expected 150,000 vs counted 149,000 → 1,000 = threshold edge စမ်းပါ                                                                                       |
| `/pos/sale-returns/new`        | Return create (restock vs damage, cash refund)                                                                                                                                                                                                                                  |
| `/sale-returns`                | **Queued returns approve** (`POST .../[id]/approve` needs `refund.approve` — admin auto)။ Test: Cashier return pending တစ်ခု approve → damage never restocks / restock batch-back ကွာခြားပုံ စစ်ပါ                                                                              |
| Sale void                      | Own-session free; other-session needs `void.approve` (admin auto) — `POST /api/pos/sales/[id]/void`                                                                                                                                                                             |
| Cart park/resume               | `/pos/cart/park`, `/resume`, `/parked` — interrupted sale suspend                                                                                                                                                                                                               |
| `/reports/z-report`            | Z-report (day close) — Admin-only report                                                                                                                                                                                                                                        |
| `/reports/cashier-performance` | Cashier-wise sales/voids/discounts                                                                                                                                                                                                                                              |
| `/reports/cash-reconciliation` | Expected vs counted per session                                                                                                                                                                                                                                                 |

Offline queue replay `/pos/checkout/sync` (idempotent)။ Idle timeout (`IDLE_TIMEOUT_SECONDS`, default 30 min)။

---

## 9. AI Features (Admin + Inventory — Cashier မရ)

> Roles: `allow=["admin","inventory"]` (PageShell + API guards, §0)။ AI service (`ai-service/`, FastAPI :8000) down နေလျှင် `AI_UNAVAILABLE` — POS/checkout မထိခိုက်။ Request/spending limit များကို ချိတ်ဆက်ထားသော provider က သတ်မှတ်ပြီး app က ကိုယ်ပိုင် quota မသတ်မှတ်ပါ။ Provider limit ကျော်လျှင် provider error ပြမည်။ History မရှိသေးလျှင် empty-state (error မဟုတ်)။

| စာမျက်နှာ         | လုပ်ဆောင်ချက် + Test Data ဥပမာ                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/ai/chat`        | မြန်မာ/English မေးခွန်း → guarded read-only SQL → narrated answer + SQL view + rows table။ Suggestion chips ပါ။ Test: `Today's total sales?` / `ဒီနေ့ ရောင်းအား ဘယ်လောက်လဲ?` — sale ရောင်းပြီးမှ မေးပါ |
| `/ai/demand-forecasting` | Moving-average demand + reorder suggestions (avg/day, on-hand, days-of-cover, suggested qty) + locale-aware summary။ `?days=` (7/30/90)။ Test: 7+ ရက် sales history ရှိမှ forecast ထွက်မည်             |
| `/ai/basket`      | Association rules (support/confidence) → draft bundles — Admin **Save draft** → `/promotions/ai-suggested` (§5.4) → Activate။ Inventory: analysis ကြည့်ရုံ (save button admin-only)                    |
| `/ai/alerts`      | Ops watchlist (rule-based, LLM မလို): dead-stock (capital tied) + supplier price-drift + void/discount outliers။ Test: 60+ ရက် မရောင်းရပစ္စည်း → dead-stock ပေါ်မည်                                    |
| Celery nightly    | `ai.nightly_forecast/basket/alerts` (2 AM Asia/Yangon, `NIGHTLY_BRANCH_CODES`) — build jobs တူညီတဲ့ code path, fail-closed                                                                             |

---

## 10. Reports — အစီရင်ခံစာ 16 pages (Admin-only, `/reports/*`)

အားလုံး branch-filtered, `GET /api/admin/reports/*`။

| #   | စာမျက်နှာ                                             | အကြောင်းအရာ + Test Data ဖြင့် ဖတ်နည်း                                                             |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | `/reports/sales`                                      | Date-range sales summary — Test: ယနေ့ Cashier sale များ total ကိုက်ကြောင်း စစ်ပါ                  |
| 2   | `/reports/profit-margin`                              | Product-wise margin                                                                               |
| 3   | `/reports/profit-loss`                                | Revenue − COGS − expenses — Test: အထက်က `10,000` expense ပါဝင်ကြောင်း စစ်ပါ                       |
| 4   | `/reports/inventory-valuation`                        | Batch cost basis valuation                                                                        |
| 5   | `/reports/inventory-aging`                            | Stock age buckets                                                                                 |
| 6   | `/reports/inventory-abc`                              | ABC classification                                                                                |
| 7   | `/reports/cash-reconciliation`                        | Session expected vs counted                                                                       |
| 8   | `/reports/cashier-performance`                        | Per-cashier KPIs                                                                                  |
| 9   | `/reports/hourly-sales`                               | Hour buckets — Test: ယခု sale ပြုလုပ်သောအချိန် bucket တက်ကြောင်း စစ်ပါ                            |
| 10  | `/reports/accounts-payable`                           | Supplier payables (GRN − payments)                                                                |
| 12  | `/reports/supplier-performance`                       | On-time/quality per supplier                                                                      |
| 13  | `/reports/tax` (+`?detail=true` IRD e-invoice export) | Tax by category — Test: General `5%` sale တစ်ခု၏ tax ကိုက်ကြောင်း စစ်ပါ                           |
| 14  | `/reports/expense-budget`                             | Budget vs actual, overruns warn                                                                   |
| 15  | `/staff` → Attendance Report tab                      | Planned shifts vs POS sessions and Inventory clock-ins (15-min grace)                             |
| 16  | `/reports/z-report`                                   | Day-close Z                                                                                       |
| 17  | (session report)                                      | Plan §12 item 2 — `GET /api/pos-sessions/[id]/report` + receipt/today-sales UI, သီးခြား page မရှိ |

> Note: "17" count = 16 report pages + session-report API။ Attendance Report ကို `/staff` အောက်မှာ ကြည့်နိုင်သည်။

---

## 11. Oversight — Audit / Backup / Cron / Roster

### 10.1 `/audit-logs`, `/audit-logs/[id]` — Audit Viewer

- Append-only (RLS INSERT+SELECT only, no UPDATE/DELETE)။ Mutation တိုင်း client IP ပါဝင်သည်။ Test: အထက်က PO approve / expense / journal တစ်ခုခု ဤတွင် entry ပေါ်မပေါ် search စစ်ပါ။

### 10.2 `/backup` — Export + Restore

- `GET /api/admin/backup` — off-platform JSON snapshot (audit-logged)။ `POST .../restore` — destructive restore။
- **စမ်းသပ်နည်း:** Export နှိပ် → JSON download ရကြောင်း စစ်ပါ။ Restore ကို production တွင် မစမ်းပါနှင့် (test DB သာ)။

### 10.3 `/cron` — Scheduled Jobs (pg_cron)

- `GET/POST/DELETE /api/admin/cron` + secret endpoint `/api/cron/alerts` (`CRON_SECRET`) — all-branch alert scan။ `/cron` UI မှ schedule စစ်ဆေးခြင်း။
- Inventory/Cashier trigger: `POST /api/admin/notifications/scan` (A+I) — မိမိ branch alert scan။

### 10.4 Printing — removed

- Hardware printing (printer registry, print queue, agent poll/ack, drawer kick) **ဖြုတ်ထားသည်** — `/printers`, `/print-queue`, `/api/pos/print`, `/api/print-agent/*`, `/api/pos/cash-drawer/*` မရှိတော့ပါ။ Receipt/labels = on-screen preview + browser print သုံးပါ။
- Public counter display: `/display/[branchCode]` — session မလို။

### 10.5 `/staff` — Staff, Roster & Attendance

- Staff management, planned shifts, and Attendance Report ကို `/staff` page ၏ သက်ဆိုင်ရာ tab များတွင် သုံးပါ။ (`GET/POST/PATCH /api/admin/shift-rosters`)။ Attendance သည် POS sessions နှင့် Inventory clock-ins ကို roster နှင့် နှိုင်းယှဉ်ပြသည်။

---

## 12. Admin ပုံမှန်လုပ်ငန်းစဉ် (Daily Checklist + Troubleshooting)

**မနက်:** `/admin` alerts စစ် → pending POs approve (`/purchase-orders`) → pending returns approve (`/sale-returns`) → roster/shift စစ် → counters/sessions အဆင်ပြေကြောင်း စစ်။
**ည:** Z-report (`/reports/z-report`) → cash reconciliation → sessions close စစ်ဆေးခြင်း → backup export (အပတ်စဉ်) → audit-logs spot-check။

| ပြဿနာ                                       | ဖြေရှင်းချက်                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GRN `409` error                             | PO unapproved — `/purchase-orders/[id]` တွင် approve အရင်လုပ်ပါ                                                                  |
| Cashier `403` (discount/credit/void/refund) | `/permissions` တွင် override ပေးမလား, Admin ကိုယ်တိုင် approve လုပ်မလား ရွေးပါ                                                   |
| Manual journal error                        | Debits = Credits စစ်ပါ (ဥပမာ 10,000 vs 10,000)                                                                                   |
| Cash drawer / hardware printing             | Removed — see §10.4                                                                                                              |
| Session ပြဿနာ / branch switch               | Session အားလုံး revoke ဖြစ် — ပြန် login ဝင်ပါ; counter တစ်ခုတွင် session တစ်ခုသာ                                                |
| OVERPAYMENT warn                            | Supplier payment များနေသည် — `/suppliers/[id]/statement` တွင် GRN vs payments ပြန်စစ်ပါ                                          |
| AI `AI_UNAVAILABLE` / blank                 | ai-service run နေလား (`uvicorn app.main:app --port 8000`) + `AI_SERVICE_URL` စစ်ပါ — POS မထိခိုက်                                |
| AI provider limit error (`429`/`402`)       | `/ai-models` တွင် provider usage/budget နှင့် key permission စစ်ပါ၊ provider reset သို့မဟုတ် budget ပြန်လည်ရရှိချိန်ကို စောင့်ပါ |
| AI empty-state (rows 0)                     | History မရှိသေး — §0 UAT script အတိုင်း sales history တည်�ောက်ပါ                                                                 |
| Telegram `TELEGRAM_NOT_CONFIGURED`          | Server `.env.local` တွင် token + chat ID စစ်ပါ → `/telegram` → Send test message                                                 |
| Telegram message မရောက်                     | Bot group member ဟုတ် + `Enabled` on + test-send စစ်ပါ                                                                           |

---

_ဆက်စပ်ဖိုင်များ: `FEATURES_ADMIN.md`, `API_ENDPOINTS.md`, `DATABASE_MIGRATIONS.md` — Inventory/Cashier အသေးစိတ်အတွက် `INVENTORY_MANUAL.md`, `CASHER_MANUAL.md` ကို ကြည့်ပါ။_
