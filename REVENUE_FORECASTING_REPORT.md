# Revenue Forecasting Report — SmartRetailAI

> This report documents the weekly revenue model separately from unit-demand forecasting. It is based on `FORECASTING_REPORT.md`, the current model implementation, and the checked-in active revenue artifact.

## အကျဉ်းချုပ်

Revenue Forecasting သည် branch တစ်ခုလုံး၏ အပတ်စဉ် net sales ကို MMK ဖြင့် ခန့်မှန်းသည်။ လာမည့် ၄ ပတ်စာ forecast ပေးပြီး အတည်ပြုပြီးသော return များကို return ဖြစ်သည့်အပတ်တွင် နုတ်သည်။ ဤ model ကို unit demand သို့မဟုတ် reorder quantity အတွက် မသုံးပါ။

## 1. Task နှင့် Output

| အချက် | ဖော်ပြချက် |
| --- | --- |
| Target | Branch အလိုက် အပတ်စဉ် net sales amount (MMK) |
| Horizon | လာမည့် ၄ ပတ် |
| Returns | Approved sale returns ကို return record ၏ week တွင် net လုပ်သည် |
| Product output | Training-period revenue အလိုက် ရွေးထားသော top 10 products ၏ next-week revenue |
| Minimum history | Completed sales history ၄၀ ပတ် |
| အသုံးပြုမှု | Revenue planning နှင့် trend analysis; stock reorder တွက်ရန် မသုံးပါ |

Forecast သည် ခန့်မှန်းတန်ဖိုးသာဖြစ်ပြီး အာမခံရောင်းအား သို့မဟုတ် cash collection မဟုတ်ပါ။

## 2. Data နှင့် Feature များ

ပြီးစီးထားသော sales ကို week အလိုက်စုစည်းပြီး approved returns ကို သက်ဆိုင်ရာ return week မှနုတ်သည်။ လက်ရှိ incomplete week ကို history ထဲမထည့်ပါ။ Branch ID အလိုက် data နှင့် artifact များကို သီးခြားထားသည်။

Model features:

- 1, 2, 4 ပတ် lagged revenue။
- 4 ပတ်နှင့် 12 ပတ် ပျမ်းမျှ revenue။
- Week-of-year seasonality အတွက် sine/cosine။
- Trend index။

Target week မတိုင်မီရှိခဲ့သော history ကိုသာ features အဖြစ်သုံးသည်။

## 3. Model နှင့် Training Flow

Model သည် XGBoost Regressor ဖြစ်သည်။ Configuration သုံးမျိုးကို validation MAE အနိမ့်ဆုံးဖြင့်ရွေးပြီး train/validation/test ကို chronological order အတိုင်း ခွဲသည်။ Final model ကို train + validation history ပေါ်တွင် fit လုပ်ပြီး held-out test ပေါ်တွင် အကဲဖြတ်သည်။

| Candidate | n_estimators | max_depth | learning_rate |
| --- | ---: | ---: | ---: |
| A | 60 | 2 | 0.04 |
| B | 100 | 2 | 0.05 |
| C | 80 | 3 | 0.04 |

Workflow: collect branch history → validate 40-week minimum → prepare weekly totals and product series → split chronologically → tune candidates → fit final model → evaluate against baselines → save model/metrics → atomically activate the branch model.

Artifacts ကို `AI_ARTIFACT_DIR/revenue/` အောက်ရှိ branch-hash directory ထဲတွင် သိမ်းသည်။ Runtime endpoints သည် `/revenue-forecast`, `/revenue-forecast/train` ဖြစ်ပြီး UI သည် `/ai/revenue-forecasting` ဖြစ်သည်။ AI Chat မှ `/revenue` နှင့် `/revenue accuracy` ကို သုံးနိုင်သည်။

## 4. လက်ရှိ Artifact နှင့် Evaluation Snapshot

Checked-in active model ကို 2026-10-28 13:10 (Asia/Yangon) တွင်လေ့ကျင့်ထားသည်။ History တွင် ၁၄၇ complete weeks ပါဝင်ပြီး 2024-01-01 week မှ 2026-10-19 week အထိဖြစ်သည်။ Held-out test သည် ၂၃ ပတ်၊ 2026-05-18 မှ 2026-10-19 အထိဖြစ်သည်။

| Model / baseline | Test MAE (MMK) | WAPE | Non-zero MAPE |
| --- | ---: | ---: | ---: |
| XGBoost weekly net revenue | 1,250,472.35 | 14.19% | 15.71% |
| 4-week moving average | 1,341,054.35 | 15.22% | 18.06% |
| 52-week seasonal naive | 1,252,282.61 | 14.21% | 16.22% |

ဤ artifact တွင် XGBoost သည် baseline နှစ်ခုထက် error နည်းသော်လည်း seasonal-naive နှင့် ကွာခြားမှု အနည်းငယ်သာရှိသည်။ Test size ၂၃ ပတ်သာဖြစ်၍ synthetic single-branch data ပေါ်က limited evaluation အဖြစ်သာ အဓိပ္ပာယ်ဖွင့်သင့်သည်။

### Active artifact forecast snapshot

| Week starting | Forecast revenue |
| --- | ---: |
| 2026-10-26 | 9,244,183 MMK |
| 2026-11-02 | 8,263,757 MMK |
| 2026-11-09 | 8,962,614 MMK |
| 2026-11-16 | 9,051,964 MMK |

ဤကိန်းဂဏန်းများသည် 2026-10-28 artifact ထဲက snapshot ဖြစ်ပြီး live/အမြဲတမ်းရလဒ်များမဟုတ်ပါ။ Model အသစ် train လုပ်ပါက ပြောင်းလဲမည်။

Top-10 product များအတွက်လည်း model နှင့် test metrics သိမ်းထားသော်လည်း next-week product estimates များသည် analytics အတွက်သာဖြစ်ပြီး demand units သို့မဟုတ် order quantity မဟုတ်ပါ။

## 5. ကန့်သတ်ချက်များနှင့် နောက်တစ်ဆင့်

- ဒေတာသည် synthetic demo data ဖြစ်ပြီး YGN branch တစ်ခုမှသာဖြစ်သည်။
- ၄၀ ပတ် minimum သည် training လုပ်ရန် သတ်မှတ်ထားသော threshold ဖြစ်ပြီး နှစ်စဉ်ရာသီအလိုက် cycle များစွာကို ကိုယ်စားပြုနိုင်မည်ဟု မဆိုလိုပါ။
- Test window သည် ၂၃ ပတ်သာဖြစ်သည်။
- Promotion, price changes, holidays, stock-outs သို့မဟုတ် planned events ကို model က input မယူပါ။
- Forecast uncertainty interval မထုတ်ပေးသေးပါ။
- Seeded sales ပြောင်းလဲပြီးနောက် branch ကို ပြန် train လုပ်ကာ metrics နှင့် timestamp ကို စစ်ဆေးရန်။
- Forecast ကို ငွေကြေး/ဝယ်ယူမှုဆုံးဖြတ်ချက်အတွက် တစ်ခုတည်းသော အခြေခံအဖြစ် မသုံးရန်။

---

*Source: `FORECASTING_REPORT.md`, `ai-service/app/features/forecasting/revenue.py`, and active run `20261028T064018187328Z`.*
