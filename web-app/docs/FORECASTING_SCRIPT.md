# Demand Forecasting — ရှင်းလင်းပြသမှု Script (UI-aligned, Step-by-step)

**ကြာချိန်:** ၁၀-၁၅ မိနစ်  
**ပြသမည့်နေရာ:** `/ai/demand-forecasting` (admin/inventory role ဖြင့် login)  
**ပြသမည့် tools:** Browser + Live training သို့မဟုတ် pre-trained model

---

## Part A — အဖွင့်နှင့် Page Overview

### A1. စတင်ခြင်း (၁ မိနစ်)

**[Page ဖွင့် — `/ai/demand-forecasting`]**

> "ဒီမှာ **Demand Forecasting** page ပါ။ ဒါက SmartRetailAI ရဲ့ AI capability တစ်ခု — historical sales data ကနေ future demand ကို predict လုပ်ပြီး reorder suggestion ထုတ်ပေးတယ်။
>
> Page ထဲဝင်ဖို့ **admin** သို့မဟုတ် **inventory** role လိုတယ်။ Admin role နဲ့ login လုပ်ထားလို့ full access ရတယ် — အထူးသဖြင့် **Train Model** button ကို နှိပ်လို့ရတယ်။"

**[Header ကို မိတ်ဆက်]**

> "Header မှာ title **'Demand Forecasting'** နဲ့ subtitle **'Seasonal-trend demand forecast with reorder suggestions — retrain to refresh the model'** ပါတယ်။ ဒီ subtitle က model ရဲ့ အမျိုးအစား — **seasonal-trend** — နဲ့ refresh ပုံစံ — **retrain လုပ်မှ refresh** ဖြစ်တယ်ဆိုတာ ပြောထားတယ်။"

**[Header action buttons ကို အစဉ်လိုက် မိတ်ဆက်]**

> "Header မှာ button သုံးခု ရှိတယ်:
>
> 1. **'Train Model with latest dataset'** — ဒါက admin only။ Model train ချင်ရင် ဒါကို နှိပ်တယ်။
> 2. **'Model details'** / **'Hide model'** — toggle ပါ။ Model training log, metrics, charts တွေ ပြ/ဖျက်လို့ရတယ်။
> 3. **AI model dropdown** — LLM narration အတွက် model ရွေးတဲ့ dropdown။ ဒါက numbers ကို မပြောင်းဘူး — summary text ပဲ ပြောင်းတယ်။"

---

## Part B — Model Details Panel (အခြေအနေ စစ်ဆေးခြင်း)

### B1. Estimator Status (၂ မိနစ်)

**['Model details' နှိပ်ပြီး panel ဖွင့်]**

> "Panel ဖွင့်လိုက်ရင် **'Demand model'** card ပေါ်လာတယ်။ ပထမဆုံး cell က **'Estimator'** — ဒါက လက်ရှိ system က ဘယ် estimator သုံးနေလဲ ပြတယ်။"

**[Case 1: Model trained ပြီး]**

> "Model train ပြီးရင် **'Seasonal-trend model'** လို့ ပေါ်တယ်။ အောက်မှာ **algorithm** ('additive_seasonal_trend'), **window** (training data ရဲ့ trailing window), **alpha** (level damping) တွေ ပါတယ်။
>
> ဒါ့အပြင် **'Trained at'** — model train ချိန်, **'Test MAE'** — test set ပေါ် model error, **'vs previous-day baseline'** — baseline ထက် ဘယ်လောက် better လဲ — ဆိုပြီး cell ၄ ခု ပါတယ်။"

**[Case 2: Model မရှိရင်]**

> "Model train မလုပ်ရသေးရင် **'Moving average (no trained model yet)'** လို့ ပေါ်တယ်။ အဲဒီအခါ system က simple trailing average ပဲ သုံးတယ် — historical 7-day mean။ Model train ပြီးရင် seasonal model ပြောင်းသွားတယ်။"

**[Baseline badges + CSV download]**

> "Model trained ဖြစ်ရင် badge တွေ ထပ်ပေါ်တယ် — **previous_day**, **moving_average_7**, **seasonal_naive_7** — ဒါတွေက model ရဲ့ test performance ကို baseline ၃ ခုနဲ့ နှိုင်းယှဉ်ပြတာ။ ဘယ်ကောင်းလဲ ဆိုတာ နောက်မှာ chart မှာ ပြမယ်။
>
> ပြီးရင် **'Download training dataset (CSV)'** link ရှိတယ် — training သုံးခဲ့တဲ့ prepared dataset ကို download လုပ်လို့ရတယ်။"

---

## Part C — Model Training (Core Demo)

### C1. Train Model Button နှိပ်ခြင်း (၁ မိနစ်)

**[Train Model button ကို မနှိုက်ခင် ရှင်းပြ]**

> "အခု **'Train Model with latest dataset'** ကို နှိုက်ပြီး live training ပြမယ်။ ဒီ button နှိုက်ရင် system က:
>
> 1. Latest sales data ကို database ကနေ collect တယ်
> 2. Dataset ပြင်ဆင်တယ်
> 3. Train/validation/test split လုပ်တယ်
> 4. Hyperparameter grid search လုပ်တယ်
> 5. Best config နဲ့ final model train တယ်
> 6. Test set ပေါ် evaluate တယ်
> 7. Artifacts save တယ်
> 8. Model activate လုပ်တယ်
>
> အားလုံး ၉ အဆင့် — ဒါတွေအားလုံးကို **real-time streaming** နဲ့ UI ပေါ်မှာ အဆင့်ဆင့် ပေါ်လာမယ်။"

**[Button နှိုက်]**

> "နှိုက်လိုက်ပါတယ် — button label က **'Training…'** ပြောင်းသွားတယ်, disabled ဖြစ်သွားတယ်။"

### C2. SSE Streaming စနစ် (၁ မိနစ်)

**[Progress bar ပေါ်လာခြင်း]**

> "Training စလိုက်ပြီ — **'Training log'** section ပေါ်လာတယ်။ ပထမ **progress bar** — **'Progress'** label နဲ့ **'0/9 steps · 0%'** counter ပါတယ်။
>
> ဒီ progress က **Server-Sent Events (SSE)** နဲ့ ရောက်လာတာ — backend training job က step ပြီးတိုင်း frontend ကို push လုပ်တယ်။ Page reload မလုပ်ဘဲ live update ဖြစ်တယ်။
>
> တစ်ဆင့်ချင်းစီ complete ဖြစ်တိုင်း step row ပေါ်လာပြီး progress bar တိုးသွားတယ်။"

### C3. ၉ အဆင့် အသေးစိတ် (၅ မိနစ်)

> "အခု training ရဲ့ ၉ အဆင့်စီကို UI label နဲ့ အတူ ရှင်းပြမယ် —"

**[Step 1 — UI label: "Collect dataset"]**

> "**Step 1: 'Collect dataset'** — database ကနေ raw sales data ယူတဲ့ အဆင့်။ `sale_detail`, `sale`, `branch`, `products`, `category`, `sale_return_detail` table တွေကို join လုပ်ပြီး branch ရဲ့ sales record အားလုံးကို CSV အဖြစ် export တယ် — **19 columns** ပါတယ် (quantity, returned_qty, payment_method စသည်)။
>
> Detail မှာ **rows** (sales line အရေအတွက်), **bytes** (file size), **sha256** (checksum), **branch_code** တွေ ပေါ်တယ်။
>
> ဒါက pipeline ထဲ database ကို **ထိတဲ့ တစ်ခုတည်းသော အဆင့်** — ကျန်တဲ့အဆင့်တွေက file ကပဲ ဖတ်တယ်။"

**[Step 2 — UI label: "Prepare dataset"]**

> "**Step 2: 'Prepare dataset'** — raw transaction data ကို clean ပြီး daily matrix ပြောင်းတဲ့ အဆင့်။ အဓိက လုပ်တာတွေ:
>
> - ပြည့်စုံမှု မရှိတဲ့ row တွေ ဖယ် (product/qty မပါ)
> - Non-completed sales (voided) ဖယ်
> - Quantity ≤ 0 ဖယ်
> - Duplicate row တွေ ဖယ်
> - **Returns ကို net ထုတ်** (qty − returned_qty)
> - **Calendar zero-fill**: product တစ်ခုချင်းစီအတွက် ရောင်းချမှုမရှိတဲ့ နေ့တွေကို **qty=0** အဖြစ် ဖြည့် — mean imputation မဟုတ်ဘူး
>
> Output က **6 columns** (branch_code, product_id, product_name, day, weekday, qty) ပါတဲ့ prepared CSV။
>
> Detail မှာ **products**, **calendar_days**, **non_zero_cells**, **sparsity_pct** (% ပြ — ဘယ်လောက် sparse လဲ), cleaning counter တွေ ပါတယ်။"

**[Step 3 — UI label: "Load dataset"]**

> "**Step 3: 'Load dataset'** — prepared CSV ကို memory ထဲ **product × day matrix** အဖြစ် load တယ်။ Row က product, column က day, cell က units sold။
>
> ဒီအဆင့်မှာ DB ကို ထိတာ မရှိ — file ကပဲ ဖတ်တယ်။ Detail မှာ matrix size (**products × days = cells**), sparsity, fill-ratio တွေ ပါတယ်။"

**[Step 4 — UI label: "Chronological split"]**

> "**Step 4: 'Chronological split'** — matrix ရဲ့ calendar ကို **chronological အတိုင်း, shuffle မလုပ်ဘဲ** ၃ ပိုင်း ခွဲတယ်:
>
> - **Train: 70%** — model သင်ဖို့
> - **Validation: 15%** — hyperparameter ရွေးဖို့
> - **Test: 15%** — final evaluation အတွက် (model ဒီ data မြင်ဖူးတာ မဟုတ်)
>
> Time-series မှာ shuffle မလုပ်ရတာ **leakage ကာဖို့** — future data ကို train မှာ ထည့်ရင် unrealistic performance ဖြစ်သွားမယ်။
>
> Detail မှာ train/validation/test ရဲ့ **date ranges** နဲ့ **share %** ပါတယ်။"

**[Step 5 — UI label: "Grid search"]**

> "**Step 5: 'Grid search'** — ဒါက model tuning ရဲ့ core။
>
> System က hyperparameter combination **၂၄ ခု** (window 6 မျိုး × alpha 4 မျိုး) စမ်းတယ်:
> - **Window**: 3, 7, 14, 21, 28, 56 ရက် — trailing mean ယူမည့် window size
> - **Alpha**: 0.0, 0.3, 0.7, 1.0 — level damping (1.0 = plain mean, 0 = frozen)
>
> တစ်ခုချင်းစီအတွက် train set ပေါ် fit လုပ်, validation set ပေါ် predict, **validation MAE** တွက်တယ်။ MAE အနည်းဆုံး config ကို ရွေးတယ်။
>
> **[Expand grid_search row ပြ]**
>
> ဒီ step ကို expand လုပ်ရင် **grid results table** ပေါ်တယ် — **window | alpha | validation MAE** ၃ ကောင်းခွဲ, MAE အနည်းဆုံး row က **green highlight + ★** နဲ့ ပြတယ်။ Worst row အထိ စာရင်းပြတယ် — best/worst **spread** က model tuning ရဲ့ value ကို ပြတယ်။
>
> Detail မှာ **configurations** (24), **best_window**, **best_alpha**, **best_validation_mae**, **worst_validation_mae**, **spread** ပါတယ်။"

**[Step 6 — UI label: "Refit final model"]**

> "**Step 6: 'Refit final model'** — ရွေးထားတဲ့ best config (ဥပမာ window=3, alpha=1.0) နဲ့ **train + validation အပြည့်** ပေါ် final model ပြန် train တယ်။ (Grid search တုန်းက train ပဲ သုံးခဲ့ — အခု validation ပါ ထည့်ပြီး fit တယ်။)
>
> Model ရဲ့ structure:
> - **Level**: damped trailing mean — နောက်ဆုံး level တန်ဖိုး
> - **Seasonal profile**: product တစ်ခုချင်းစီအတွက် **weekday residual** 7 ခု (Mon-Sun) — ဥပမာ Saturday မှာ ပုံမှန်ထက် ပိုရောင်းရင် positive, Monday မှာ နည်းရင် negative
>
> **[Seasonal profile bars ပြ]**
>
> Detail ကို expand လုပ်ရင် **seasonal profile bars** ပေါ်တယ် — Mon-Sun bar chart, green (≥0) red (<0)။ ဒီ product ရဲ့ weekly pattern ကို visualize လုပ်ပြတာ။
>
> Detail မှာ **window**, **alpha**, **fit_days**, **products_fitted**, **level_last**, **seasonal_profile** array ပါတယ်။"

**[Step 7 — UI label: "Evaluate on test"]**

> "**Step 7: 'Evaluate on test'** — model မြင်ဖူးခြင်းမရှိတဲ့ **test set (last 15%)** ပေါ် model ကို စစ်ဆေးတယ်။
>
> Metrics:
> - **Model MAE**: mean absolute error (items ဖြင့်)
> - **WAPE**: weighted absolute percentage error
> - **Non-zero MAE**: ရောင်းချမှုရှိတဲ့ နေ့တွေအတွက်ပဲ error
> - **Baseline comparison**: previous_day, moving_average_7, seasonal_naive_7 နဲ့ နှိုင်းယှဉ်
> - **Improvement %**: baseline ထက် ဘယ်လောက် better
> - **Best/worst product**: error အနည်း/အများဆုံး product
>
> Detail မှာ **model_mae**, **improvement_vs_baselines**, **best_product**, **worst_product** ပါတယ်။"

**[Step 8 — UI label: "Write artifacts"]**

> "**Step 8: 'Write artifacts'** — trained model နဲ့ metrics ကို disk ပေါ် save တယ်:
> - `model.json` — fitted parameters (JSON, **pickle မသုံး** — security + portability)
> - `metrics.json` — all test metrics + per-product MAE + 5 product ရဲ့ actual/predicted chart series
>
> ရေးတာက **atomic** (tmp file ကနေ os.replace) — crash ဖြစ်ရင် half-written file ကျန်မယ်။"

**[Step 9 — UI label: "Activate model"]**

> "**Step 9: 'Activate model'** — ဒါက နောက်ဆုံးအဆင့်။ `active.json` pointer ရေးတယ် — ဒါကြောင့် serving path (forecast query) က **ဒီ model ကိုပဲ** load သုံးတယ်။
>
> `active.json` ထဲ model dict + test metrics + branch info embed လုပ်ထားတယ်။ ဒါရေးပြီးရင် training complete — **progress bar 100%** ပြည့်တယ်, step rows အားလုံး **green dot** ဖြစ်တယ်။"

**[Training complete — SSE done]**

> "SSE stream က **done event** ပို့တယ် — frontend ကို run_id, model metadata, metrics ရောက်လာတယ်။ Training ပြီးတာနဲ့ page က **auto reload** ဖြစ်ပြီး model details ပြန်ပြတယ် — အခု **'Seasonal-trend model'** ဖြစ်သွားပြီ။"

---

## Part D — Charts (Model Performance Visualization)

### D1. Model vs Baselines Chart (၁ မိနစ်)

**['Model details' panel ထဲ chart grid ပေါ်လာခြင်း]**

> "Model trained ပြီးရင် chart ၃ ခု ပေါ်လာတယ်။
>
> **ပထမ chart: 'Model vs baselines (test MAE)'** — bar chart ပါ။ X axis မှာ **Model** + baseline ၃ ခု, Y axis မှာ MAE။ Model bar က baseline တွေထက် **နိမ့်ရင်** model က ပိုကောင်းတယ် — MAE နည်းလေ error နည်းလေ။
>
> ကျွန်တော်တို့ run မှာ **Model MAE = 1.875** — **previous_day baseline (2.958)** ထက် **36.6% better**။ **moving_average_7 (2.265)** ထက်လည်း better, **seasonal_naive_7 (2.939)** ထက်လည်း better။ ဒါက model ရဲ့ value ကို ပြတယ် — simple baseline တွေထက် ပိုတိက်တယ်။"

### D2. MAE by Product Chart (၁ မိနစ်)

> "**ဒုတိယ chart: 'MAE by product'** — product ၁၂ ခုအတွက် error ကို bar chart ပြတယ်။ ဘယ် product ကို model က ပိုတိက်/နည်းတိက်စွာ predict လုပ်လဲ ဆိုတာ ကြည့်လို့ရတယ်။
>
> Per-product MAE ကို metrics.json ထဲ သိမ်းထားတယ် — table အားလုံးကို ကြည့်ချင်ရင် CSV ထဲမှာ ရှိတယ်။"

### D3. Actual vs Predicted Chart (၁ မိနစ်)

> "**တတိယ chart: 'Actual vs predicted — [product name] (test window)'** — line chart ပါ။ Solid line က **Actual** (မှန်တကယ်ရောင်းချမှု), dashed line က **Predicted** (model prediction)။
>
> Legend ကို chart အောက်မှာ ပြတယ် — **'Actual'** solid, **'Predicted'** dashed။ ဒီမှာ actual line နဲ့ predicted line **ဘယ်လောက်နီးလဲ** ကို ကြည့်လို့ရတယ် — lines နီးရင် model accurate။
>
> Test sample အဖြစ် product ၅ ခုကို သိမ်းထားတယ် — chart မှာ product ပြောင်းကြည့်လို့ရတယ်။"

---

## Part E — Forecast Results & Reorder Suggestions

### E1. Summary + Stats Cards (၁ မိနစ်)

**[Summary card]**

> "Chart အောက်မှာ **'Summary'** card — LLM narration။ Forecast data ကို LLM က natural language အဖြစ် ပြန်ဖော်ပြတာ — ဥပမာ 'X product အတွက် နောက် ၁၀ ရက် ပျမ်းမျှ Y units ရောင်းရနိုင်တယ်, Z ခု reorder လိုတယ်' ဆိုတဲ့ summary။"

**[Stats cards — grid of 4]**

> "Stats cards ၄ ခု:
> - **'Products analyzed'** — branch အတွက် analyze လုပ်ခဲ့တဲ့ product အရေအတွက်
> - **'Need reorder'** — အခု reorder လိုအပ်တဲ့ product အရေအတွက် (red)
> - **'Suggested units'** — total suggested reorder quantity
> - **'History window'** — training သုံးခဲ့တဲ့ history days (default 30d)"

### E2. Reorder Suggestions Table (၂ မိနစ်)

**['Reorder suggestions' card]**

> "အဓိက output — **'Reorder suggestions'** table။
>
> Checkbox **'Show only products needing reorder'** ရှိတယ် — default checked (order လိုအပ်တဲ့ product ပဲ ပြ)။ Uncheck လုပ်ရင် product အားလုံး ပေါ်တယ်။
>
> Table columns:
>
> 1. **'Product'** — product name, low stock ဖြစ်ရင် **'low stock'** badge ပါ
> 2. **'Avg / day'** — model ရဲ့ **predicted daily demand** (model မရှိရင် trailing average)။ ဒါက **future-looking** — historical average မဟုတ်ဘူး
> 3. **'On hand'** — လက်ရှိ stock
> 4. **'Days of cover'** — `on_hand ÷ avg` — stock ဘယ်နှစ်ရက် ခံမလဲ
> 5. **'Suggested qty'** — reorder အကြံပြု quantity
> 6. **'Status'** — **'order'** badge (reorder လို) သို့မဟုတ် **'ok'** badge (လုံလောက်)

**[Reorder formula ရှင်းပြ]**

> "Reorder calculation က:
>
> ```
> need = avg_daily_sales × (lead_time + safety) − on_hand
> ```
>
> Default အားဖြင့် lead time 7 ရက် (supplier delivery) + safety 3 ရက် (buffer) = **10 ရက်** စာ လုံလောက်အောင် ထားခိုင်းတာ။
>
> **ဥပမာ**: Product X — avg 5/day, on_hand 45။ `45 < 5×10=50` → **order** ဝင်တယ်, suggested qty = 5 units။
>
> Avg/day က model prediction ဖြစ်လို့ **weekday seasonality ပါတယ်** — weekend မှာ ပိုရောင်းရမယ်ဆိုရင် weekend prediction ပိုများပြီး reorder suggestion လည်း ပိုတိက်တယ်။ Plain average နဲ့ ဆို ဒါ မလုပ်နိုင်ဘူး။"

> "Table က product အများဆုံး **100** ပဲ ပြတယ် (performance) — အားလုံးကြည့်ချင်ရင် pagination ရှိတယ်။"

---

## Part F — Work Process အကျဉ်းချုပ်နှင့် Architecture

### F1. End-to-End Flow (၂ မိနစ်)

> "အခု entire work process ကို အကျဉ်းချုပ် ပြန်ပြောမယ် —"
>
> "**Frontend (Next.js)** → Admin **'Train Model'** နှိုက် → SSE request `GET /stream/forecast_train` → Next.js SSE relay `/api/ai/sse` → **AI Service (FastAPI)** `ForecastTrainJob` run → ၉ အဆင့် execute → step ပြီးတိုင်း SSE `status` event push → Frontend live update → `done` event → reload → model details ပြန်ပြ"
>
> "**Serving path**: Forecast query → Next.js `/api/ai/forecast` → AI service `ForecastBuildJob` → `active.json` model load → future 10 days predict → mean demand → reorder formula blend → response → UI table"
>
> "**Model artifact တွေ** `artifacts/forecast/` ထဲ သိမ်းတယ်:
> - `dataset_raw.csv` (step 1)
> - `dataset_prepared.csv` (step 2)
> - `runs/<timestamp>/` — model.json, metrics.json, steps.json, manifest.json (step 8)
> - `active.json` — serving pointer (step 9)
>
> All writes **atomic** — tmp + replace။"

### F2. Model Quality ရလဒ် (၁ မိနစ်)

> "ကျွန်တော်တို့ baseline results (test window, 4,312 cells):
>
> | Model | MAE | Note |
> |---|---|---|
> | **Seasonal-trend (trained)** | **1.875** | Best |
> | moving_average_7 | 2.265 | |
> | seasonal_naive_7 | 2.939 | |
> | previous_day | 2.958 | |
>
> **Model က previous_day baseline ထက် 36.6% better** — ဒါက model ရဲ့ practical value ကို ပြတယ်။ WAPE 0.944, best val config window=3, alpha=1.0 (24 configs ထဲက)။"

---

## Part G — Demo Tips & FAQ (Team Walkthrough)

### G1. Demo Script Tips

> "**Demo အတွက် tips**:
>
> 1. **Live train မလုပ်ခင်** — pre-trained model ရှိရင် အရင် show ပြီး, ပြီးမှ live train ပြ
> 2. **Grid search expand** — 24-row table ★ ပြတာ ပြ
> 3. **Seasonal profile bars** — Mon-Sun pattern ရှင်းပြ (ဥပမာ weekend spike)
> 4. **Actual vs Predicted line** — solid vs dashed, ဘယ်လောက် close လဲ ပြ
> 5. **Reorder formula** — example product နဲ့ calculate ပြ
> 6. **Download CSV** — provenance/transparency ပြ"

### G2. Supervisor FAQ အတွက်

> "**Supervisor မေးနိုင်တဲ့ မေးခွန်းများ**:
>
> **Q: Algorithm က ဘာလဲ?**  
> A: Additive seasonal-trend — damped trailing mean level + per-weekday residual profile. Pure Python, no pickle.
>
> **Q: ဘယ်လို evaluate လဲ?**  
> A: Chronological 70/15/15 split. Test set (last 15%) ပေါ် MAE, WAPE, non-zero MAE + 3 baselines နဲ့ နှိုင်းယှဉ်. Improvement 36.6%.
>
> **Q: Data leakage ရှိလား?**  
> A: မရှိ — chronological split, shuffle မလုပ်. Grid search validation ပဲ သုံး, test set ကို final evaluation အတွက်ပဲ.
>
> **Q: ဘယ်လို secure လဲ?**  
> A: AI service separate microservice, read-only DB role, model JSON (no pickle), atomic writes.
>
> **Q: Production မှာ ဘယ်လို serve လဲ?**  
> A: active.json pointer → ForecastBuildJob loads → predicts next lead+safety days → mean demand → reorder formula. Auto retrain nightly job ရှိတယ်.
>
> **Q: Performance ကောင်းလား?**  
> A: MAE 1.875 items (avg), WAPE 94.4%. Baseline 3 ခုထက် အကောင်းဆုံး. Intermittent demand အတွက် non-zero MAE ပါ report လုပ်ထားတယ်."

---

## Part H — Closing (၃၀ စက္ကန့်)

> "အကျဉ်းချုပ် — Demand Forecasting page က **9-step training pipeline**, **real-time SSE streaming**, **model evaluation vs 3 baselines**, **seasonal pattern visualization**, နဲ့ **data-driven reorder suggestions** တွေ ပေးတယ်။ Model က historical pattern ကို လေ့လာပြီး future demand ကို predict လုပ်ကာ, reorder formula နဲ့ blend လုပ်ပြီး stock decision support ပေးတယ်။ ကျေးဇူးတင်ပါတယ် — questions ရှိရင် ဖြေကြားပါ့မယ်။"

---

*Script ends — UI label တိုင်း exact text အတိုင်း ညှိထားသည်။*
