# Demand Forecasting Report — SmartRetailAI

> Based on `FORECASTING_REPORT.md`, the current demand-forecasting implementation, and checked-in training artifacts. Historical metrics are identified as such and are not a new evaluation after the seed range extension.

## အကျဉ်းချုပ်

Demand Forecasting သည် ပစ္စည်းတစ်မျိုးချင်းစီ၏ နေ့စဉ်ရောင်းချမည့် အရေအတွက်ကို ခန့်မှန်းပြီး ပြန်မှာယူရန်လိုအပ်နိုင်သော ပစ္စည်းများနှင့် အကြံပြုအရေအတွက်ကို ဖော်ပြသည်။ Revenue model နှင့် သီးခြားဖြစ်ပြီး Purchase Order ကို အလိုအလျောက်မတင်ပါ။

## 1. ရည်ရွယ်ချက်နှင့် ခန့်မှန်းမည့်အရာ

| အချက် | ဖော်ပြချက် |
| --- | --- |
| Target | Product တစ်မျိုးချင်းစီ၏ နေ့စဉ်ရောင်းချသည့် quantity (units) |
| Horizon | နောက်တစ်နေ့ခန့်မှန်းချက်; reorder calculation အတွက် lead time ၇ ရက် + safety ၃ ရက် = ၁၀ ရက် |
| အသုံးပြုမှု | Stock coverage, suggested quantity နှင့် reorder priority ပြရန် |
| AI ၏ အခန်းကဏ္ဍ | အကြံပြုချက်သာပေးသည်။ လူက စစ်ဆေးပြီးမှ Purchase Order တင်သည်။ |

Revenue (MMK) ကို ဒီ model ၏ target အဖြစ် မသုံးပါ။ ဈေးနှုန်း၊ discount နှင့် promotion များကြောင့် ဝင်ငွေပြောင်းလဲမှုသည် unit demand ပြောင်းလဲမှုနှင့် မတူနိုင်ပါ။

### ပြန်မှာယူမှုတွက်ချက်ပုံ

```text
suggested_qty = max(0, avg_daily_demand × (lead_time_days + safety_days) − on_hand)
```

လက်ရှိ default တွင် lead time ၇ ရက်နှင့် safety ၃ ရက်ဖြစ်သည်။ `suggested_qty > 0` ဖြစ်ပါက `needs_order` သတ်မှတ်ပြီး လိုအပ်သောပစ္စည်းများကို အရင်၊ အကြံပြုအရေအတွက်များသူကို ဦးစားပေးစီသည်။

## 2. ဒေတာနှင့် ပြင်ဆင်မှု

| အချက် | Training artifact တွင် မှတ်တမ်းတင်ထားသော တန်ဖိုး |
| --- | --- |
| အရင်းအမြစ် | Demo seeder မှ PostgreSQL ထဲထည့်ထားသော synthetic sales data |
| Branch | YGN — Main Branch |
| Products | ၂၈ |
| Raw rows | ၁၅,၉၉၀ sale-detail rows |
| Prepared rows | ၂၈,၇၂၈ product-day rows (၂၈ × ၁,၀၂၆ ရက်) |
| Artifact date range | 2024-01-01 မှ 2026-10-22 |
| Cleaning | Duplicate ၂,၃၆၂ rows ဖယ်ရှား၊ returns ၃၉ units ကို နုတ်၊ voided sales မပါဝင် |
| Zero-fill | ရောင်းအားမရှိသည့်နေ့ကို 0 ဖြင့်ဖြည့်သည်။ Mean imputation မလုပ်ပါ။ |

`seed-demo.ts` ကို 2026-10-28 အထိ data ထုတ်ရန် ပြင်ထားသော်လည်း ဤနေရာရှိ demand artifact သည် 2026-10-22 အထိသာ ဖြစ်သည်။ Database ကို seed ပြန်လုပ်ပြီး training run အသစ်လုပ်သည့်အခါမှ artifact အသစ်သည် နောက်ဆုံးရက်အထိ ရောက်မည်။

## 3. Model နှင့် လုပ်ငန်းစဉ်

Model သည် `additive_seasonal_trend` ဖြစ်ပြီး trailing demand level နှင့် weekday seasonal profile ကို ပေါင်းစပ်သည်။

```text
ŷ[t] = damped_trailing_level[t] + seasonal_profile[weekday(t)]
```

`window ∈ {3, 7, 14, 21, 28, 56}` နှင့် `alpha ∈ {0, 0.3, 0.7, 1.0}` တို့ကို validation MAE ဖြင့် grid-search လုပ်သည်။ Model parameters ကို JSON အဖြစ်သိမ်းသည်။

### Training workflow

1. Branch အလိုက် sale lines နှင့် returns ကို PostgreSQL မှ CSV ထုတ်ယူသည်။
2. မပြည့်စုံသော rows၊ မသက်ဆိုင်သော status နှင့် duplicates များကို ကိုင်တွယ်ပြီး returns ကို net လုပ်သည်။
3. Product × calendar-day grid ပြုလုပ်ကာ မရှိသောနေ့များကို quantity 0 ဖြင့်ဖြည့်သည်။
4. အချိန်အစဉ်အတိုင်း train 70%, validation 15%, test 15% ခွဲသည်။
5. Validation ပေါ်တွင် configuration ရွေးပြီး train + validation ပေါ်တွင် final model ပြန် fit လုပ်သည်။
6. Held-out test တွင် model နှင့် baseline များကို အကဲဖြတ်ကာ model, metrics, steps နှင့် manifest JSON များသိမ်းသည်။

### Serving workflow

Branch အလိုက် မကြာသေးမီကာလ၏ daily quantities နှင့် on-hand stock ကိုဖတ်သည်။ Branch နှင့်ကိုက်ညီသော trained seasonal model ရှိလျှင် သုံးပြီး မရှိလျှင် moving-average fallback သုံးသည်။ ရလဒ်ထဲတွင် daily average, on-hand, days of cover, reorder threshold, suggested quantity နှင့် `needs_order` ပါသည်။

UI သည် `/ai/demand-forecasting` ဖြစ်ပြီး AI Chat မှ `/demand`, `/demand 7|30|90`, `/demand reorder` ဖြင့်လည်းခေါ်နိုင်သည်။

## 4. အကဲဖြတ်မှုနှင့် မှတ်တမ်းတင်ထားသောရလဒ်

နောက်ဆုံး checked-in demand artifact မှာ `20261022T135027Z_YGN` ဖြစ်သည်။ Test window သည် 2026-05-22 မှ 2026-10-22 အထိ ၁၅၄ ရက်၊ product-day cells ၄,၃၁၂ ခုဖြစ်သည်။

| နည်းလမ်း | Test MAE (items/day) | Test WAPE (ratio) |
| --- | ---: | ---: |
| Previous-day baseline | 2.958 | 1.489 |
| 7-day moving-average baseline | 2.265 | 1.140 |
| 7-day seasonal-naive baseline | 2.939 | 1.480 |
| Additive seasonal-trend | 1.875 | 0.944 |

ဒီ run ၏ validation MAE သည် 1.928 ဖြစ်သည်။ Source report က metric snapshot ကို leakage correction မတိုင်မီက ရလဒ်ဟု သတိပေးထားသဖြင့် training artifact အသစ်ဖြင့် ပြန်အကဲဖြတ်ပြီးသည်အထိ 1.875 ကို လက်ရှိ performance claim အဖြစ် မသုံးသင့်ပါ။

## 5. ကန့်သတ်ချက်များနှင့် နောက်တစ်ဆင့်

- ဒေတာသည် synthetic demo data ဖြစ်ပြီး production sales မဟုတ်ပါ။
- လက်ရှိစစ်ဆေးထားသည့် dataset သည် YGN branch နှင့် products ၂၈ မျိုးသာ ပါဝင်သည်။
- Promotion, price change နှင့် holiday features မပါဝင်ပါ။
- Intermittent demand နှင့် zero-sales days များသောကြောင့် MAE/WAPE ကို တွဲဖက်အဓိပ္ပာယ်ဖွင့်ရန်လိုသည်။
- Seed ကို 2026-10-28 အထိပြန် run ပြီးနောက် dataset အသစ်စုဆောင်း၊ model ပြန်လေ့ကျင့်၊ leakage-corrected metrics ပြန်ထုတ်ရန်လိုသည်။
- နောက် run ၏ ID, dataset hash, split dates နှင့် actual-vs-predicted chart ကို သိမ်းဆည်းရန်။

---

*Source: `FORECASTING_REPORT.md`, `ai-service/app/features/forecasting/`, and `ai-service/artifacts/forecast/runs/20261022T135027Z_YGN/`.*
