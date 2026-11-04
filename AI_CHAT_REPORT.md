# AI Chat Report — SmartRetailAI

> This report describes current AI Chat behavior based on the forecasting report, web-app implementation, and the AI service's read-only SQL and forecast routes.

## အကျဉ်းချုပ်

AI Chat သည် user ၏ branch အတွင်း sales, products, inventory, purchase orders, suppliers, POS sessions နှင့် profit margin ဆိုင်ရာဖတ်ရှုမေးမြန်းမှုများကို ဖြေဆိုပေးသည်။ Slash commands ဖြင့် Demand/Revenue forecasts ကိုခေါ်နိုင်ပြီး follow-up မေးခွန်းများနှင့် period comparisons ကိုလည်း ပံ့ပိုးသည်။ Database ပြောင်းလဲမှုများကို Chat မှ မလုပ်နိုင်ပါ။

## 1. လက်ရှိ စွမ်းဆောင်ရည်များ

### Read-only data Q&A

- English သို့မဟုတ် Myanmar ဖြင့် မေးနိုင်သည်။
- Intent classification က query request ကိုခွဲခြားပြီး registered SQL tool ရွေးနိုင်သည်။
- Tool မကိုက်ညီပါက live database schema ကိုအခြေခံ၍ model က SELECT တစ်ခုရေးဆွဲသည်။
- SQL guard က read-only, branch scope, allowed schema နှင့် row limit ကိုစစ်သည်။
- ရလဒ်ကို findings, summary, suggestions အဖြစ်ရှင်းပြပြီး အများဆုံး ၅၀ rows ပြသည်။ UI တွင် plan, SQL နှင့် result rows များကို စစ်ဆေးနိုင်သည်။

### Registered query tools

| Tool | အလုပ် |
| --- | --- |
| `today_sales` | ယနေ့ completed sales နှင့် revenue |
| `sales_by_day` | နေ့အလိုက် sales trend |
| `top_products` | Quantity/revenue အရောင်းအများဆုံးပစ္စည်းများ |
| `category_sales` | Category အလိုက် sales နှင့် quantity |
| `low_stock` | Reorder threshold ရောက်/အောက် stock |
| `expiring_batches` | မကြာမီသက်တမ်းကုန်မည့် batches |
| `po_status` | Status အလိုက် purchase orders |
| `supplier_spend` | Supplier အလိုက် order spend |
| `session_summary` | POS session cash reconciliation |
| `profit_margin` | Revenue, estimated cost, profit နှင့် margin |

## 2. Slash Commands နှင့် Forecast ချိတ်ဆက်မှု

Input box တွင် `/` ရိုက်လျှင် command suggestions ပြသည်။ Forecast response ကို စာသားတစ်ခုတည်းမဟုတ်ဘဲ metrics, product table သို့မဟုတ် comparison chart ပါသော card အဖြစ်ပြသည်။

| Command | လုပ်ဆောင်ချက် |
| --- | --- |
| `/demand`, `/demand 7`, `/demand 30`, `/demand 90` | ရွေးထားသောကာလအတွက် demand/reorder အချက်အလက် |
| `/demand reorder` | ပြန်မှာရန်လိုအပ်နိုင်သောပစ္စည်းများ |
| `/revenue` | လာမည့် ၄ ပတ် revenue forecast |
| `/revenue accuracy` | Model history နှင့် evaluation metrics |
| `/compare sales 7`, `/compare sales 30`, `/compare sales 90` | တူညီသောကာလအရှည်ရှိ ယခင်ကာလနှင့် လက်ရှိရောင်းရငွေ နှိုင်းယှဉ်ချက် |
| `/compare revenue` | ပြီးခဲ့သည့် ၄ ပတ် actual နှင့် လာမည့် ၄ ပတ် forecast ကို နှိုင်းယှဉ်ချက် |

Revenue forecast အတွက် trained model နှင့် complete sales history အနည်းဆုံး ၄၀ ပတ် လိုအပ်သည်။ မပြည့်ပါက ရှိသည့်ပတ်နှင့် လိုအပ်သည့်ပတ်ကို ဖော်ပြသည်။ Slash command နောက်တွင် custom question ဆက်ရေးပါက forecast result နှင့် branch-scoped SQL result ကိုပေါင်းစပ်ဖြေဆိုနိုင်သည်။

## 3. Conversation Context နှင့် သိမ်းဆည်းခြင်း

- Conversation/message များကို database ထဲသိမ်း၍ ရှိပြီးသား chat များကို ပြန်ဖွင့်နိုင်သည်။
- Conversation သည် user ID နှင့် branch ID နှင့်ချိတ်ထားပြီး API သည် owner နှင့် branch ကိုစစ်ဆေးသည်။
- Follow-up မေးခွန်းများအတွက် နောက်ဆုံး complete messages လေးခုကို chronological context အဖြစ် ပို့သည်။ Message တစ်ခုလျှင် content ၄၀၀ characters အထိဖြတ်ထားသည်။
- ယခင် assistant forecast မှ လိုအပ်သည့် structured fields များကိုသာ context ထဲထည့်သည်။
- User သည် available AI model ကိုရွေးနိုင်ပြီး ရရှိပါက token/cost usage ကိုသိမ်းသည်။

History သည် ရှင်းလင်းသော reference များကိုဖြေရှင်းရန်သာဖြစ်သည်။ လက်ရှိမေးခွန်းကို အဓိကထားပြီး history ကို system instruction အဖြစ် မသုံးရန် prompt က သတ်မှတ်ထားသည်။

## 4. Architecture နှင့် လုံခြုံရေးကန့်သတ်ချက်များ

```text
Chat UI
  → authenticated Next.js SSE route
  → AI service (/stream/rag or /stream/chat-forecast)
  → registered SQL tool or guarded model-generated SELECT
  → branch-scoped read-only query / existing forecast service
  → structured SSE events and saved assistant response
```

- Chat SSE route သည် admin နှင့် inventory roles အတွက်သာဖြစ်သည်။
- Branch ID ကို authenticated session မှရယူသည်၊ model က မရွေးချယ်နိုင်ပါ။
- AI database assistant သည် SELECT-only ဖြစ်ပြီး query ကို branch-scope နှင့် LIMIT guard ဖြတ်စစ်သည်။
- Forecast commands သည် ရှိပြီးသား forecast functions များကိုခေါ်သည်။ LLM သည် result ကိုရှင်းပြနိုင်သော်လည်း structured forecast ကိန်းဂဏန်းများကို ဖန်တီး/ပြန်တွက်ရန် မရည်ရွယ်ပါ။
- Chat သည် sale, stock သို့မဟုတ် purchase order ကို create/update/delete မလုပ်နိုင်ပါ။

## 5. Evaluation Plan နှင့် လက်ရှိအခြေအနေ

`FORECASTING_REPORT.md` တွင် AI Chat အတွက် business questions ၁၀ ခုအပေါ် answer correctness စမ်းသပ်ရန် အကြံပြုထားသည်။ သို့သော် source report ထဲတွင် test results သို့မဟုတ် quality score မပါသေးသောကြောင့် လက်ရှိအောင်မြင်မှုရာခိုင်နှုန်းကို မဆိုနိုင်ပါ။

အကြံပြု acceptance cases:

| Case | စမ်းသပ်မှု | လက်ခံစံ |
| --- | --- | --- |
| Sales facts | “ဒီနေ့ ရောင်းရငွေ ဘယ်လောက်လဲ?” | Authenticated branch နှင့် date boundary မှန်ကန်၊ result ကို DB နှင့်ကိုက်ညီစေခြင်း |
| Stock | “ပြန်မှာရန်လိုအပ်တာတွေပြပါ” | On-hand နှင့် threshold ကိုမှန်ကန်စွာတွက်ခြင်း |
| Follow-up | “အဲဒီထဲက ဘယ်ဟာအများဆုံးလဲ?” | မကြာသေးမီ context ကိုသာ reference အတွက်သုံးခြင်း |
| Forecast | `/demand 30`, `/revenue` | Structured API result နှင့် UI card တူညီခြင်း |
| Comparison | `/compare sales 30` | ကာလနှစ်ခုမထပ်ခြင်း၊ difference နှင့် percentage မှန်ကန်ခြင်း |
| Write request | Data ဖျက်/ပြင်ရန် တောင်းဆိုခြင်း | SQL မထုတ်ဘဲ read-only ကန့်သတ်ချက်ကိုရှင်းပြခြင်း |
| Locale | English/Myanmar တူညီသောမေးခွန်း | ဖြေဆိုဘာသာစကား မှန်ကန်ပြီး ကိန်းဂဏန်းများမပြောင်းခြင်း |

### ကန့်သတ်ချက်များ

- Model-generated SQL သည် schema, model output နှင့် SQL guard အပေါ်မူတည်သည်။ Guard ဖြတ်သန်းခြင်းသည် business answer မှန်ကြောင်းတစ်ခုတည်းနဲ့ အာမခံခြင်းမဟုတ်ပါ။
- Row output ကို ၅၀ အထိသာပြပြီး context ကို နောက်ဆုံး message အနည်းငယ်သာ ထည့်သည်။
- Forecast များသည် decision support ဖြစ်ပြီး automatic procurement action မလုပ်ပါ။
- AI Chat answer quality အတွက် အတည်ပြုထားသော evaluation score မရှိသေးပါ။ Acceptance set ကို run လုပ်ပြီး result မှတ်တမ်းတင်ရန်လိုသည်။

---

*Source: `FORECASTING_REPORT.md`, `web-app/app/(dashboard)/ai/chat/`, `web-app/app/api/ai/sse/`, `web-app/lib/ai-chat.ts`, `ai-service/app/features/rag/`, and `ai-service/app/api/routes/chat_forecast.py`.*
