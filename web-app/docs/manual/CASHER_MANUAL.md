# Cashier User Manual — ငွေကိုင်ဝန်ထမ်း (cashier1)

> Role: `cashier` | Test Account: `cashier1 / Cashier@123` (PIN login လည်း ရ — Admin `/staff` မှာ PIN သတ်မှတ်ထားလျှင်)
> Workspace: `/dashboard` → auto-redirect → `/pos` → `/dashboard/cashier` (today's sales, active session)
> Sidebar: POS terminal + new sale return + Today's sales + handover + end session (Sales/Cash sections)
> **မရနိုင်သောအရာများ (403 + UI-hidden):** Master data, purchasing, stock, transfers, suppliers, promotions, expenses, GL, reports, audit, backup, roster · `/api/admin/*` (POS-shared surface မှလွဲ၍ အားလုံး)

---

## 0. စမ်းသပ်အချက်အလက် (Test Data)

| အမျိုးအစား                    | တန်ဖိုး                                                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch                        | `YGN / Main Branch` — own-branch data သာ မြင်ရ                                                                                                                                                             |
| Login                         | `cashier1 / Cashier@123`; PIN login = password အစား 4–6 digit PIN (ဥပမာ `1234` — Admin ဖန်တီးပေးမှ သုံးနိုင်)                                                                                              |
| Counters                      | Counter 1 (Main Entrance), Counter 2 (Back Entrance) — တစ်ခုတွင် active session တစ်ခုသာ                                                                                                                    |
| Products                      | Seed တွင် product မပါ — Inventory/Admin ထည့်ပေးသော `Test Noodle 55g` (General `5%` tax, PCS, `500` Kyat) + promotion `Test 10% Off` ဖြင့် စမ်းပါ                                                           |
| Permission defaults (cashier) | `discount.approve`, `void.approve` (other-session), `refund.approve`, `transfer.approve`, `supplier_return.confirm` — လိုအပ်လျှင် Admin `/permissions` တွင် ဖွင့်ပေးမည် သို့မဟုတ် Admin approve စောင့်ရမည် |
| Kyat rounding                 | `roundingUnit = 50`; cash discrepancy threshold `1,000` (end-session alert)                                                                                                                                |
| Idle timeout                  | `IDLE_TIMEOUT_SECONDS` default 30 min — stale session auto-end                                                                                                                                             |

---

## 1. Login & Landing

### 1.1 `/login` — Login (password သို့မဟုတ် PIN)

- **Password login:** `cashier1` + `Cashier@123` → `/dashboard` → `/pos`။
- **PIN login:** username `cashier1` + PIN (ဥပမာ `1234`) — password alternative, cashier-only, bcrypt-hashed (`users.pin_hash`)။ Admin/inventory PIN မရ။
- **TOTP:** Cashier 2FA enroll လုပ်ထားလျှင် code ထပ်တောင်းမည် (`/api/auth/login` → `TOTP_REQUIRED`)။

### 1.2 `/pos` + `/dashboard/cashier` — Cashier Home

- **မြင်ရမည့်အရာ:** today's sales (own-session), active session card (counter/session id), shortcuts → terminal/today-sales/handover/end-session။
- Seed-fresh တွင် sales 0 — အောက်ပါ §2–§3 အတိုင်း sale ရောင်းပြီးမှ numbers တက်မည်။

---

## 2. POS Session Lifecycle (အဆင့်ဆင့် — အစဉ်လိုက် လုပ်ပါ)

### 2.1 `/pos/select-counter` — Counter ရွေးပြီး Session ဖွင့်ခြင်း

1. Counter list မှ ရွေးပါ → Test: `Counter 1`။
2. `Open/Select` နှိပ် (`GET/POST /api/pos-sessions/select`) — ထို counter တွင် active session ရှိနေလျှင် ထို session သို့ join; မရှိလျှင် အသစ်ဖွင့်။
3. **စည်းမျဉ်း:** one active session per counter — session မပိတ်ဘဲ ဒုတိယတစ်ခု ဖွင့်၍ မရ။ `GET /api/pos-sessions/current` သည် terminal အတွက် active session ပြန်ပေးသည်။

### 2.2 `/pos/terminal` — ရောင်းချခြင်း (အဓိကစာမျက်နှာ)

- Header ညာဘက်တွင် **End session** button (→ `/pos/end-session`) — ရောင်းပြီးတိုင်း session ပိတ်ဖို့ သတိရရန်။ Sidebar Cash section မှာလည်း `End session` link ရှိသည်။
- **Product search:** `GET /api/pos/products/search` — FEFO-aware availability (expiry အနီးဆုံး batch အရင်လျော့မည်)။ Stock check: `GET /api/pos/products/[id]/stock`။
- **Cart:** DB-backed per session (`GET/POST/PATCH/DELETE /api/pos/cart`) — refresh/pole လုပ်လည်း မပျက်။
- **Auto-calc (ကိုယ်တိုင်တွက်စရာ မလို):** promotions auto-applied (`Test 10% Off` → line discount auto), per-line tax from category (General `5%`), Kyat rounding (50), Decimal math။
- **Park/Resume:** interrupted sale → `POST /api/pos/cart/park` → နောက်မှ `.../resume`, list `.../parked`။ Test: ပစ္စည်း 2 ခု�ည့် → park → cart clear ဖြစ်ကြောင်း စစ် → parked list မှ resume → items ပြန်ပေါ်ကြောင်း စစ်ပါ။
- **စမ်းသပ်ဥပမာ:** `Test Noodle 55g × 2 @ 500` = `1,000` → promo `−100 (10%)` → subtotal `900` → tax `5% = 45` → rounding → total → checkout (§3)။

### 2.3 `/pos/today-sales` — ယနေ့ရောင်းအား (own-session)

- Session-scoped day sales list (`GET /api/pos/today-sales`)။ မိမိ session sales သာ — အခြား session/counter sales မပေါ်ပါ။ Row click → `/pos/receipt/[saleId]` reprint။

### 2.4 `/pos/handover` — Blind-count Handover (shift လွှဲခြင်း)

- **လုပ်ဆောင်ချက်:** လက်ရှိငွေသားကို **blind-count** (system expected မပြဘဲ) ရေတွက် → entry (`GET/POST /api/pos/handovers`) → session stays open (မပိတ်ပါ)။
- **စမ်းသပ်နည်း:** Counted `150,000` ရိုက်ထည့်ပါ → Submit → handover record create → နောက် shift cashier ဆက်ရောင်းနိုင်သည်။ Expected vs counted ကွာခြားမှု နောက်မှ reconciliation တွင် ပေါ်မည်။

### 2.5 `/pos/end-session` — Till ရေတွက်ပြီး Session ပိတ်ခြင်း

1. Counted cash ထည့်ပါ → `POST /api/pos-sessions/[id]/close` (cash reconciliation) + X-report (`GET .../report`)။
2. **Threshold:** discrepancy > `1,000` Kyat လျှင် Admin alert တက်မည်။
3. **စမ်းသပ်နည်း:** Expected `150,000` ရှိစဉ် counted `150,000` ထည့်ပိတ်ပါ → clean close။ `149,000` (diff `1,000` = threshold edge) စမ်းပါ → alert logic Admin ဘက်တွင် စစ်နိုင်သည်။
4. ပိတ်ပြီးနောက် ထို counter တွင် session အသစ် ဖွင့်နိုင်သည် (§2.1)။

### 2.6 `/pos/receipt/[id]` — Receipt Preview + QR e-receipt

- On-screen preview + legacy `/r/[saleNumber]` receipt။ Hardware printing ဖြုတ်ထားသည် — preview သို့မဟုတ် browser print သုံးပါ။
- **စမ်းသပ်နည်း:** Sale တစ်ခုရောင်းပြီး receipt QR ကို ဖုန်းဖြင့် scan → e-receipt ပေါ်မပေါ် စစ်ပါ။

---

## 3. Checkout — `/pos/terminal` Checkout + `POST /api/pos/checkout`

### 3.1 Tenders (ငွေပေးချေနည်းများ)

| Tender                  | ထည့်ရမည့်အရာ + Test ဥပမာ                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Cash                    | Amount → change auto။ Test: total `945` → cash `1,000` → change `55` (rounding သတိ)                                               |
| Card                    | Last-4 only (PAN မသိမ်းပါ — `4111` ကဲ့သို့ 4 digits)                                                                              |
| Mobile                  | Provider + txn id (unique guard — txn id ထပ်လျှင် reject)။ Test provider `KBZPay`, txn `TEST-TXN-001` → ထပ်သုံးလျှင် error ပြရမည် |
| Loyalty redeem          | Points → discount                                                                                                                 |
| Credit-note application | Note number apply                                                                                                                 |
| Installment creation    | Down-payment + plan create (dues နောက် Inventory/Admin collect)                                                                   |

Manual discount (`discount.approve`) သည် **default denied** — discount ထည့်လျှင် error/approval-queue; Admin `/permissions` တွင် ဖွင့်ပေးထားမှသာ တိုက်ရိုက်ရ။

### 3.2 Offline Mode — Queue + Sync + Mirror

- Internet ပျက်လျှင် sales queue (local) → ပြန်ရလျှင် `POST /api/pos/checkout/sync` idempotent replay (ထပ်ပို့လည်း double-charge မဖြစ်)။
- **Mirror (§14.3a):** queued sale တိုင်း IndexedDB + localStorage **နှစ်နေရာ** တွင် ပြိုင်တူသိမ်းသည်။ Browser storage တစ်ခု ပျက်သွားလည်း terminal ပြန်ဖွင့်လျှင် auto-recover (`N offline sale(s) recovered from backup store`) — queue counter (`Offline queue (n)`) ကို အမြဲစစ်ပါ။
- **စမ်းသပ်နည်း:** Offline sale 1 ခု queue → online ပြန်ဖြစ်လျှင် sync → `/pos/today-sales` တွင် တစ်ကြိမ်သာ ပေါ်ကြောင်း စစ်ပါ။

### 3.3 Stock/Tax/Promo Math (auto — သိထားရန်)

- FEFO deduction, promo auto, category tax, Kyat rounding, Decimal precision — `POST /api/pos/checkout` **P** (permission-gated)။ GL auto-post (4000 Revenue / 5000 COGS / 2100 Tax) same txn။

---

## 4. Voids & Returns (Admin approve လိုနိုင်သည်)

### 4.1 Void — `POST /api/pos/sales/[id]/void` (**P**)

- **Own-session void:** free — မိမိ session sale ကို自由 void။
- **Other-session void:** needs `void.approve` (default cashier denied → Admin)။
- **စမ်းသပ်နည်း:** `/pos/today-sales` မှ ကိုယ်ပိုင် sale တစ်ခု void စမ်းပါ → stock ပြန်တက် + GL reverse ဖြစ်ကြောင်း (Admin view) စစ်ပါ။ အခြား counter sale void စမ်းလျှင် `403`/queue ဖြစ်ရမည်။

### 4.2 `/pos/sale-returns/new` — Sale Return အသစ် + `/sale-returns` status

- **Create:** sale ရွေး → items/qty + reason (`POST /api/sale-returns` **P**)။
- **Without `refund.approve` → queues `pending for Admin`** (default cashier flow)။ Approve (`POST .../[id]/approve` **P**) သည် Admin/resolution:
  - `restock` → batch back (stock ပြန်တက်)
  - `damage` → **never restocks** (stock ပြန်မတက်)
- **စမ်းသပ်နည်း:** Sale တစ်ခု → `Test Noodle × 1 (defective)` return create → status `pending` ဖြစ်ကြောင်း `/sale-returns` တွင် စစ်ပါ → admin1 approve → restock/damage အလိုက် `/stock` စစ်ပါ။

---

## 5. Blocked / Notes / Troubleshooting

### 5.1 Explicitly Blocked (expected `403` + UI-hidden — error မဟုတ်ပါ)

`/api/admin/*` (POS-shared မှလွဲ၍) · master data · purchasing · stock · transfers · suppliers · promotions · expenses · GL · reports · audit · backup · roster။

### 5.2 Notes

- Own-branch sales only; customer records are not collected.
- Idle 30 min → stale session end → ပြန် login + counter reselect။

### 5.3 Troubleshooting

| ပြဿနာ                                    | ဖြေရှင်းချက်                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Discount/credit/void/return `403`        | Expected — Admin approve/override စောင့်ပါ (`/permissions` Admin ဖွင့်ပေးနိုင်သည်)                      |
| GRN/stock/promotion menu မပေါ်           | Expected — cashier hidden                                                                               |
| Counter "already has active session"     | ထို counter session အရင်ပိတ် (`/pos/end-session`) သို့မဟုတ် join; Counter 2 ပြောင်းစမ်းပါ               |
| Mobile txn "duplicate"                   | Txn id ထပ်နေသည် — အသစ် (`TEST-TXN-002`) သုံးပါ                                                          |
| Return `pending` မပြီးသေးပါ              | Admin approve စောင့်နေသည် — `/sale-returns` status စစ်ပါ                                                |
| Session expired/logout ဖြစ်              | Idle timeout သို့မဟုတ် branch-switch revoke — ပြန် login                                                |
| Offline queue 0 ဖြစ်သွား (မမျှော်လင့်ဘဲ) | Terminal refresh လုပ် — mirror recovery auto-run; `recovered from backup store` message ပေါ်မပေါ် စစ်ပါ |

---

_ဆက်စပ်ဖိုင်များ: `FEATURES_CASHER.md`, `API_ENDPOINTS.md` — Admin/Inventory flows အတွက် `ADMIN_MANUAL.md`, `INVENTORY_MANUAL.md` ကို ကြည့်ပါ။_
