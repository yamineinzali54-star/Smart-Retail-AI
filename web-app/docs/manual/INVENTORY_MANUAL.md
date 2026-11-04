# Inventory User Manual — ကုန်ပစ္စည်းစီမံခန့်ခွဲသူ (inventory1)

> Role: `inventory` | Test Account: `inventory1 / Inventory@123` | Branch: `YGN - Main Branch`
> Workspace: `/dashboard` → auto-redirect → `/inventory` (low-stock, expiry, reorder KPIs)
> Sidebar: stock/expiry/PO/GRN/ground-balance/transfers/adjustments/supplier-returns/products/categories/units/suppliers + bulk-import + **Tools** (AI Chat, Forecasting, Market Basket, Ops Alerts)
> Customer profiles, customer-linked sales, RFM segments, credit sales, vouchers, credit notes and installments have been removed. POS sales store no customer data.
> **မရနိုင်သောအရာများ:** POS terminal, cart/checkout/sessions/handovers · promotions · expenses/budgets · GL · petty-cash · staff/branches/counters · permissions · audit-logs · backup · roster · cron · `/reports/*` · PO approve/reject · void/refund/discount approvals (403 + UI-hidden)

---

## 0. စမ်းသပ်အချက်အလက် (Test Data)

| အမျိုးအစား                      | တန်ဖိုး                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch                          | `YGN / Main Branch` (session branch-scope — မိမိ branch data သာ မြင်ရ; switch လုပ်လျှင် session အားလုံး revoke → ပြန် login)                                        |
| Login                           | `inventory1 / Inventory@123`                                                                                                                                        |
| Category                        | `General` (shortName `G`, tax `5.00%`)                                                                                                                              |
| Unit                            | `Piece` (`PCS`) — barcode batch generation အတွက် `short_name` မဖြစ်မနေ လိုသည်                                                                                       |
| Supplier                        | Seed တွင် မပါ — အောက်ပါ §1–§2 အတိုင်း `Test Supplier` ကိုယ်တိုင်ထည့်ပြီး စမ်းပါ                                                                                     |
| Counters                        | Counter 1/2 (ကြည့်နိုင်သော်လည်း manage မရ — Admin-only)                                                                                                             |
| COA                             | 13 accounts (ကြည့်ရုံသာ — GL စာမျက်နှာများ ဖွင့်၍ မရ)                                                                                                               |
| Permission (inventory defaults) | `transfer.approve = true`; `discount/refund/void/supplier_return.confirm` = false → Admin ထံ queue                                                                  |
| Dataset                         | `docs/dataset/` — units → categories → products → suppliers → PO lines (9 POs) → GRN lines အစဉ်လိုက် သွင်း (`README.md`); product/category/unit names အတိအကျ တူရမည် |
| AI history                      | Forecast/Basket/Alerts သည် sales history ပေါ် တွက်သည် — seed-fresh မှာ empty-state (error မဟုတ်); GRN receive → sale 7+ ရက် ရောင်းပြီးမှ စစ်ပါ                      |

> GL-posting writes (GRN, adjustments, write-offs, transfer receipts) သည် **same-transaction အတွင်း auto-post** — သီးခြားအဆင့် မလိုပါ။

---

## 1. Master Data — `/products`, `/categories`, `/units`, `/suppliers`, `/bulk-import`

### 1.1 `/inventory` — Inventory Dashboard

- **မြင်ရမည့်အရာ:** low-stock KPI, expiry KPI, reorder KPI။
- **အသုံးပြုပုံ:** နီပြနေသော card click → `/stock` (low-stock) / `/expiry` (expiry) / `/purchase-orders/new` (reorder) သို့ ခုန်မည်။ မနက်တိုင်း ဤမှ စပါ။

### 1.2 `/products` — ကုန်ပစ္စည်းစာရင်း (CRUD)

- **Fields:** name, category, units (sale/purchase), barcode, price-history view, UOM conversions။
- **စမ်းသပ်နည်း (အဆင့်ဆင့်):**
  1. `New` → Name `Test Noodle 55g`, Category `General`, Sale unit `PCS`, Sale price `500`, Wholesale `450` → Save။
  2. Detail ဖွင့် → `UOM conversion` tab → `1 BOX = 12 PCS` (BOX unit ကို `/units` မှာ အရင်ထည့်ပါ) သတ်မှတ်ပါ။
  3. Price-history view တွင် ဈေးပြောင်းလဲမှု မှတ်တမ်းပေါ်မည် (`PATCH /api/admin/stock/[itemId]` hook)။
- **API:** `GET/POST /api/admin/products`, `GET/PATCH /[id]`, `GET/POST /[id]/uom-conversion`။

### 1.3 `/categories` — အမျိုးအစားများ (tax rate ပါဝင်သည်)

- **Fields:** name, shortName (unique — barcode အတွက် မဖြစ်မနေလို), taxRate, isTaxExempt။
- **စမ်းသပ်နည်း:** `Test-Exempt` (shortName `TE`, tax `0`, exempt true) ထည့်ပါ → ထိုပစ္စည်း checkout tax `0` ဖြစ်ကြောင်း Cashier နှင့် တွဲစစ်ပါ။ `General 5.00%` ကို မဖျက်ပါနှင့် (seed default)။
- Soft-delete only။ Bulk import: `/api/admin/categories/import` + `/template`။

### 1.4 `/units` — ယူနစ်များ

- **Fields:** name, shortName (unique, ဥပမာ `PCS`, `BOX`, `KG`)။
- **စမ်းသပ်နည်း:** `Box` (`BOX`) ထည့်ပါ → Product UOM `1 BOX = 12 PCS` ချိတ်ပါ → GRN ကို BOX ဖြင့် လက်ခံသောအခါ PCS သို့ auto-convert ဖြစ်ကြောင်း §3 တွင် စစ်ပါ။

### 1.5 `/suppliers` + `/suppliers/[id]/statement` — Supplier များ

- **Fields:** name, phone, address။ Payable = GRN − payments (auto-derived)။
- **စမ်းသပ်နည်း:** `Test Supplier / 09-123456789` ထည့်ပါ → §3 PO/GRN flow တွင် ထို supplier သုံးပါ → statement စာမျက်နှာတွင် GRN entries + payments + outstanding ပေါ်မပေါ် စစ်ပါ။

### 1.7 `/bulk-import` — အစုလိုက်သွင်းခြင်း

- **Flow:** Template download (`.../template`) → CSV ပြင်ပါ → Upload → **preview** စစ်ပါ → **commit** (single transaction — အမှားတစ်ခုပါလျှင် အားလုံး rollback)။
- **စမ်းသပ်နည်း:** products template download → `Test Bulk 1`, `Test Bulk 2` (General/PCS) 2 rows ထည့် → preview တွင် 2 rows မှန်ကြောင်း စစ် → commit → `/products` တွင် ပေါ်မပေါ် စစ်ပါ။ Suppliers/categories လည်း ထိုနည်းတူ။

---

## 2. Purchasing Flow — `/purchase-orders/*` → `/grn/*` → payments → `/supplier-returns/*`

> အဓိက flow: **Create PO (draft) → Admin approval စောင့် → GRN လက်ခံ → Supplier payment → (လိုအပ်လျှင်) Supplier return**

### 2.1 `/purchase-orders` — PO စာရင်း

- Columns: PO number, supplier, status, totals, payment_status။ Draft/editable/approved/rejected/partially_received/received။

### 2.2 `/purchase-orders/new` — PO အသစ်ဖန်တီးခြင်း

1. Supplier ရွေး → `Test Supplier`။
2. Product rows ထည့် → `Test Noodle 55g × 100 PCS @ 400` = `40,000` (Decimal totals auto)။
3. Save → status `draft`။
4. Lookups API: `GET /api/admin/purchase-orders/lookups` (suppliers + products picker)။

### 2.3 `/purchase-orders/[id]` — PO Detail (Inventory လုပ်နိုင်�/မလုပ်နိုင်)

- **လုပ်နိုင်သည်:** draft edit (`PATCH` — draft only; approved/received ပြင်မရ) + detail ကြည့်ခြင်း။
- **မလုပ်နိုင်သည် (403):** `Approve` / `Reject` buttons မပေါ်ပါ (Admin-only `POST .../approve`, `.../reject`)။ နှိပ်စမ်းလျှင် `403`။
- **စမ်းသပ်နည်း:** Draft PO ဖန်တီးပြီး admin1 ဖြင့် approve ခိုင်းပါ → status `approved` ပြောင်းလာကြောင်း refresh ဖြင့် စစ်ပါ။ Reject ဖြစ်လျှင် GRN လုံးဝလုပ်မရ။

### 2.4 `/grn`, `/grn/new`, `/grn/[id]`, `/grn/by-po/[poId]` — Goods Receiving

- **လုပ်ငန်းစဉ်:**
  1. `/grn/by-po/[poId]` (သို့ `/grn/new` မှ PO ရွေး) ဖွင့်ပါ — approved PO သာရမည် (unapproved → `409` error, ဒါသည် expected behavior)။
  2. Received qty + unit ထည့်ပါ (ဥပမာ `10 BOX` — UOM conversion at confirm → `120 PCS` အဖြစ် stock တက်မည်)။
  3. Confirm → batch cost updated, PO status recomputed (`partially_received`/`received`), GL auto-post (1200 Inventory Dr)။
- **စမ်းသပ်နည်း:** အထက် PO (`100 PCS`) ကို `100 PCS` အပြည့်လက်ခံပါ → `/stock` တွင် `Test Noodle 55g +100` တက်လာကြောင်း + PO status `received` ဖြစ်ကြောင်း စစ်ပါ။

### 2.5 Supplier Payments — `POST /api/admin/supplier-payments` (UI: supplier statement/payment form)

- `payment_status` recomputed; **OVERPAYMENT warns** (block မလုပ်ပါ)။
- **စမ်းသပ်နည်း:** `Test Supplier` အား `20,000` ပေးပါ → statement outstanding `40,000 → 20,000` လျော့ကြောင်း စစ်ပါ။ `50,000` (overpay `10,000`) ထပ်ပေးစမ်းပါ → OVERPAYMENT warning ပေါ်မည်။

### 2.6 `/supplier-returns`, `/supplier-returns/new`, `/supplier-returns/[id]` — Supplier Returns

- **Flow:** Draft create (return qty + reason) → **confirm needs `supplier_return.confirm`** (default Admin-only → inventory draft သည် Admin ထံ queue)။
- **စမ်းသပ်နည်း:** `Test Noodle 55g × 5 PCS (damaged)` draft ဖန်တီးပါ → detail တွင် confirm button မရပါ (403) → admin1 ဖြင့် confirm ခိုင်းပါ → stock လျော့ + GL post ဖြစ်ကြောင်း စစ်ပါ။

---

## 3. Stock Flows — `/stock`, `/expiry`, `/ground-balance`, `/stock-transfers`, `/stock-adjustments`

### 3.1 `/stock` — Batch-level Stock List

- Branch-scoped batch balances (batch_no, expiry, qty, cost)။ Row click → `/stock/[itemId]` detail (movements + price history) → `/stock/[itemId]/labels` barcode-label on-screen preview။
- **စမ်းသပ်နည်း:** GRN လက်ခံပြီးနောက် `Test Noodle 55g` row တွင် qty `100 PCS` ပေါ်မပေါ် + batch_no မှတ်ထားပါ (ground-balance/expiry စမ်းရန် လိုမည်)။

### 3.2 `/expiry` — Expiry Buckets → Write-off / Reorder

- Buckets: expired / near-expiry။
- **Actions:**
  - Write-off (`POST /api/admin/expiry/[itemId]/write-off`, damaged/expired) — GL-posted (5200) + audit။
  - Reorder (`POST /api/admin/expiry/reorder`) — reorder list မှ PO raise။
- **စမ်းသပ်နည်း:** Near-expiry batch တစ်ခု → `damaged 3 PCS write-off` လုပ်ပါ → `/stock` qty လျော့ + `/gl/*` (Admin view) entry တက်ကြောင်း Admin နှင့် တွဲစစ်ပါ။ Reorder → PO draft အသစ် auto-create ဖြစ်ကြောင်း `/purchase-orders` တွင် စစ်ပါ။

### 3.3 `/ground-balance`, `/ground-balance/new`, `/ground-balance/[batchNo]` — Physical Counts

- Count-only entry (system qty vs counted qty)။
- **စမ်းသပ်နည်း:** Batch_no (အထက်ကမှတ်ထားသော) ရွေးပါ → counted `98` (system `100` — ကွာခြားမှု `2`) ရိုက်ထည့်ပါ → Save → variance record ပေါ်မည်။ Adjustment လိုလျှင် §3.5 တွင် သီးခြားလုပ်ပါ။

### 3.4 `/stock-transfers`, `/stock-transfers/new`, `/stock-transfers/[id]` — Transfers

- Lifecycle: `pending → approved → in_transit → received`။
- **Approve needs `transfer.approve` — inventory defaults `true`** (inventory ကိုင်သော တစ်ခုတည်းသော approval — `POST/PATCH /api/admin/stock-transfers`)။
- **စမ်းသပ်နည်း:** Branch2 (Admin ဖန်တီးပေးထားလျှင်) သို့ `Test Noodle 55g × 10` transfer create → approve (ကိုယ်တိုင်လုပ်နိုင်) → in_transit → received → दोनों branch stock (`/stock`) အတက်အကျ စစ်ပါ။ Receipt သည် GL-posted (same txn)။

### 3.5 `/stock-adjustments` — Adjustments (damage/loss/found/correction)

- Posts immediately + audit (`GET/POST /api/admin/stock-adjustments`)။
- **စမ်းသပ်နည်း:** `Test Noodle 55g / damage / 2 PCS / "box crushed"` adjustment ထည့်ပါ → `/stock` ทันที လျော့ကြောင်း + audit entry (Admin `/audit-logs` တွင် စစ်နိုင်) စစ်ပါ။

---

## 4. Money Views + Installment Collection (issuance မရ — list/collect သာ)

| စာမျက်နှာ | လုပ်နိုင်ချက် + Test Data ဥပမာ |
| --------- | ------------------------------ |

---

## 5. AI Views — Read-only Analysis (Tools menu)

> Inventory မြင်နိုင်/သုံးနိုင်; **save/activate/approve actions အားလုံး admin-only** (button မပေါ် / 403)။ API: `GET /api/ai/*` (A+I)။ AI service down → `AI_UNAVAILABLE`; provider rate/spending limit ကျော် → provider error; history မရှိ → empty-state။

| စာမျက်နှာ         | လုပ်နိုင်ချက် + Test Data ဥပမာ                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/ai/chat`        | မြန်မာ/English မေးခွန်း → SQL + answer + rows။ Test: GRN/sale ရှိပြီးမှ `Which batches are low on stock?` မေးပါ                                     |
| `/ai/demand-forecasting` | Demand forecast + reorder suggestions (`?days=7/30/90`)။ Test: fast-mover (Mama/Noodle) suggested qty တက်မတက် စစ်ပါ                                 |
| `/ai/basket`      | Association rules + draft bundles — **Save draft button မပေါ်** (admin-only `POST /api/ai/basket/save`)။ Test: multi-item sales ရှိမှ rules ထွက်မည် |
| `/ai/alerts`      | Dead-stock + price-drift + void/discount outliers။ Test: 60+ ရက် မရောင်းရ batch → dead-stock ပေါ်မပေါ် စစ်ပါ                                        |

---

## 6. ပုံမှန်လုပ်ငန်းစဉ် + Troubleshooting

**မနက်:** `/inventory` KPIs စစ် → low-stock → reorder PO draft → expiry buckets စစ် → write-off/reorder → Admin approval စောင့်နေသော POs/returns follow-up။
**နေ့လည်:** GRN လက်ခံမှုများ → supplier payments → transfers receive → adjustments/counts။
**ည:** `/stock` spot-check → pending drafts (PO/returns/transfers) စာရင်းချုပ် → Admin approve-queue ရှိကြောင်း အကြောင်းကြားပါ။

| ပြဿနာ                                      | ဖြေရှင်းချက်                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| GRN `409`                                  | PO unapproved — Admin approve စောင့်ပါ (ကိုယ်တိုင် approve လုပ်၍ မရ, 403)                       |
| PO edit မရ                                 | draft-only editable — approved/received သည် read-only                                           |
| Confirm button မပေါ် / `403`               | `supplier_return.confirm` Admin-only — draft အဖြစ် သိမ်း, Admin confirm ခိုင်းပါ                |
| Checkout/terminal မပေါ်                    | Expected — inventory role တွင် POS hidden (403 + UI-hidden)                                     |
| Reports/GL/expenses မပေါ်                  | Expected — Admin-only                                                                           |
| OVERPAYMENT warn                           | Payment များနေသည် — supplier statement တွင် GRN vs paid ပြန်စစ်ပါ                               |
| Branch switch → logout ဖြစ်                | Expected — all sessions revoked → ပြန် login (`inventory1/Inventory@123`)                       |
| AI `AI_UNAVAILABLE` / provider limit error | ai-service run စစ်ပြီး Admin ကို provider budget/limit စစ်ခိုင်းပါ — stock/PO/GRN work မထိခိုက် |
| AI empty-state                             | Sales history မရှိသေး — §0 dataset flow အတိုင်း GRN → sale 7+ ရက် တည်ဆောက်ပါ                    |

---

_ဆက်စပ်ဖိုင်များ: `FEATURES_INVENTORY.md`, `API_ENDPOINTS.md` — Admin/Cashier flows အတွက် `ADMIN_MANUAL.md`, `CASHER_MANUAL.md` ကို ကြည့်ပါ။_
