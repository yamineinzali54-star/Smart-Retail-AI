# AI Chat — ရှင်းလင်းပြသမှု Script (UI-aligned, Step-by-step)

**ကြာချိန်:** ၁၀-၁၅ မိနစ်  
**ပြသမည့်နေရာ:** `/ai/chat` (admin/inventory role ဖြင့် login)  
**ပြသမည့် tools:** Browser + live question တစ်ခု (Myanmar သို့မဟုတ် English)

---

## Part A — အဖွင့်နှင့် Page Overview

### A1. စတင်ခြင်း (၁ မိနစ်)

**[Page ဖွင့် — `/ai/chat`]**

> "ဒီမှာ **AI Chat** page ပါ။ ဒါက SmartRetailAI ရဲ့ **natural-language database query** feature — user က မြန်မာလို သို့မဟုတ် အင်္ဂလိပ်လို မေးခွန်းမေးရင် system က database ကို ဖတ်ပြီး answer ပြန်ပေးတယ်။
>
> Page ထဲဝင်ဖို့ **admin** သို့မဟုတ် **inventory** role လိုတယ် — cashier တွေ မဝင်ရဘူး။"

**[Header ကို မိတ်ဆက်]**

> "Header မှာ title **'AI Chat'** — Myanmar mode မှာလည်း 'AI Chat' ပဲ ပေါ်တယ်။ Subtitle က locale ပေါ် မူတည်တယ်:
> - English: **'Ask about sales, stock and orders — read-only, within your branch'**
> - Myanmar: **'အရောင်း၊ စတော့နှင့် အော်ဒါများကို မေးနိုင်သည် — ကိုယ့် branch အတွင်း၊ ဖတ်ရှုရန်သာ'**
>
> Subtitle ထဲ 'read-only' နဲ့ 'within your branch' ဆိုတဲ့ စကားလုံး ၂ ခု ပါတယ် — **ဒီ AI က data ပြောင်းလဲလို့ မရဘူး**, ဒါ့အပြင် **ကိုယ့် branch ရဲ့ data ပဲ ဖတ်လို့ရတယ်** — ဒါက ဒီ feature ရဲ့ security contract ပဲ။"

---

## Part B — UI Layout (စာမျက်နှာ ဖွဲ့စည်းပုံ)

### B1. Two-column layout (၁ မိနစ်)

**[Layout ကို ညာဘက်ကနေ ဘယ်ဘက် ရှင်းပြ]**

> "Layout က column ၂ ခု ရှိတယ် —
>
> **ဘယ်ဘက် (main)** — **'Conversation'** card။ ဒါက မေးခွန်းထုတ်ပြီး answer ကြည့်တဲ့ နေရာ။
>
> **ညာဘက်** — **'Chat history'** card (desktop မှာ တွေ့ရတယ်)။ ယခင်မေးခွန်းတွေ သိမ်းထားတဲ့ conversation list ပါ။
>
> ညာဘက် card က sticky — scroll လုပ်ရင် မလွယ်ကူဘူး။"

**['Chat history' ကို အသေးစိတ် ရှင်းပြ]**

> "'Chat history' card ထဲ:
> - **'New chat'** button — conversation အသစ် စချင်ရင် ဒါကို နှိပ်တယ်
> - Conversation list — title တစ်ခုချင်းစီ ပေါ်တယ်၊ active conversation ကို highlight လုပ်ထားတယ်
> - တစ်ခုချင်းစီမှာ **'×'** delete button ရှိတယ် — conversation ဖျက်ချင်ရင်
> - ဘာမှ မသိမ်းရသေးရင် **'No saved conversations yet.'** လို့ ပေါ်တယ်"

---

## Part C — Live Question Demo (Core)

### C1. မေးခွန်း မေးခြင်း (၂ မိနစ်)

**[Empty state ကို ပြ]**

> "Page ဖွင့်စ အခြေအနေမှာ suggestion chips ၆ ခု ပေါ်တယ် — **'Try one of these:'**:
>
> 1. 'Today's total sales?'
> 2. 'Top 5 products by quantity sold this week?'
> 3. 'Which products are at or below reorder level?'
> 4. 'Sales in the last 7 days by day?'
> 5. 'ဒီနေ့ ရောင်းအား ဘယ်လောက်လဲ?'
> 6. 'စတော့ ကုန်ခါနီး ပစ္စည်း ၁၀ မျိုး ပြပါ'
>
> Myanmar question နဲ့ English question နှစ်မျိုးလုံး ထည့်ထားတယ် — system က question ရဲ့ ဘာသာစကားကို detect လုပ်ပြီး **အတူတူဘာသာစကားနဲ့** answer ပြန်တယ်။"

**[Model dropdown ကို ပြ]**

> "Input field ရဲ့ ဘယ်ဘက်မှာ **model dropdown** ရှိတယ် — 'Choose a model' လို့ ပေါ်တယ်။ Dropdown ဖွင့်ရင် available models စာရင်း + provider chip (OpenRouter) ပေါ်တယ်။
>
> ရွေးထားတဲ့ model က **localStorage** ထဲ သိမ်းထားတယ် — နောက်တစ်ခါ ဖွင့်ရင် အတူတူ model ပဲ ပြန်ရွေးထားတယ်။
>
> Model မရှိရင် **'No active AI models are available. Ask an admin to enable a model.'** လို့ ပြတယ် — admin က Settings ထဲမှာ model enable လုပ်ပေးရမယ်။"

**[Question တစ်ခု ရိုက်ထည့်]**

> "အခု **'ဒီနေ့ ရောင်းအား ဘယ်လောက်လဲ?'** လို့ မေးမယ် — question က **500 characters** အထိ ခွင့်ပြုတယ်။ ရိုက်ထည့်ပြီး **'Ask'** button (Myanmar: **'မေးမည်'**) နှိုက်တယ် — သို့မဟုတ် suggestion chip တစ်ခုကို နှိုက်တယ်။"

### C2. ၇ အဆင့် Progress (၃ မိနစ်)

**[Live bubble ပေါ်လာခြင်း]**

> "Ask နှိုက်လိုက်ပြီ — အောက်မှာ **live bubble** ပေါ်လာတယ် (dashed border)။ ထဲမှာ:
>
> 1. ကိုယ့်မေးခွန်း
> 2. လက်ရှိ status text
> 3. **'Worked for' timer** — စက္ကန့်နဲ့ count လုပ်နေတယ်
> 4. **၇ အဆင့် progress grid** — ၁-၇ number chips, complete ဖြစ်ရင် **✓** ပြောင်းသွားတယ်
> 5. **Activity log** — timestamp နဲ့ event စာရင်း (collapsible)
>
> ဒီ progress က **Server-Sent Events (SSE)** နဲ့ ရောက်လာတာ — backend က phase ပြီးတိုင်း push လုပ်တယ်။ **Token streaming မဟုတ်ဘူး — phase streaming** — step တစ်ခုချင်းစီ ပြီးတိုင်း UI update ဖြစ်တယ်။"

**[၇ အဆင့်စီကို ရှင်းပြ]**

> "၇ အဆင့်က — ဒါတွေက backend pipeline ရဲ့ phases တွေနဲ့ တိုက်ရိုက် ကိုက်တယ် —
>
> **Step 1 — 'Checking whether the request only reads data…'** — **Intent gate**။ LLM က မေးခွန်းကို ဖတ်ပြီး read လား write လား classify လုပ်တယ်။ Write (data ပြောင်းဖို့) ဖြစ်ရင် **ရှေ့ဆက်မလုပ်ဘဲ ငြင်းတယ်** — 'This AI chat can only read database information. It cannot add, edit, or delete data.'
>
> **Step 2 — 'Checking the database tables and columns…'** — **Schema load**။ System က live database schema (table စာရင်း, column စာရင်း) ကို ယူတယ် — 30 စက္ကန့် cache ရှိတယ်။
>
> **Step 3 — 'Turning your question into a SQL query…'** — **SQL generation**။ LLM က schema ကို ကြည့်ပြီး question ကို SELECT query အဖြစ် ပြောင်းတယ်။
>
> **Step 4 — 'Checking branch scope and read-only rules…'** — **SQLGuard validation** — ဒါက security core, နောက်မှာ အသေးစိတ် ရှင်းပြမယ်။
>
> **Step 5 — 'Retrieving data from the database…'** — **Execution**။ Query ကို read-only transaction ထဲမှာ run တယ်, 5 စက္ကန့် timeout ရှိတယ်။
>
> **Step 6 — 'Preparing the findings and summary…'** — **Narration**။ LLM က database rows ကို natural language answer အဖြစ် ပြန်ဖော်ပြတယ် — findings + summary။
>
> **Step 7** — 'Asking the model to explain the query or database error…' — **Failure diagnosis** — အမှားဖြစ်ရင်ပဲ ပေါ်တယ်, success ဖြစ်ရင် ဒီ step ကို ကျော်တယ်။"

**[Tier architecture ကို ထိုးထည့် ရှင်းပြ]**

> "Step 3 မှာ system က tier ၄ ခု စဉ်းစားတယ် — cost သက်သာအောင် —
>
> **Tier 2 — Cache (LLM call 0 ခု)** — မေးခွန်း တူရင် cache ကနေ SQL ပြန်ယူတယ် — branch + ဒီနေ့ရဲ့ schema hash + question hash ကို key အဖြစ် သုံးတယ်။ Cache hit ဖြစ်ရင် LLM တစ်ခါမှ မခေါ်ဘူး။
>
> **Intent gate (LLM call 1 ခု)** — read/write classify (Step 1 နဲ့ တူ)။
>
> **Tier 1 — Pre-written tool (LLM call 1 ခု)** — 'today's sales' လို common question တွေအတွက် server-side template ရှိတယ်။ Match ဖြစ်ရင် template ပဲ run တယ် — ပိုမြန်တယ်, ပိုစိတ်ချရတယ်။
>
> **Tier 3 — Full generation (LLM call 2 ခု)** — cache/tool မမီရင် full schema + question ကို LLM ထဲ ထည့်ပြီး SQL generate လုပ်တယ်။
>
> **Tier အားလုံးက SQLGuard ကို ဖြတ်ရမယ်** — cache က SQL ဖြစ်ဖြစ်, tool template ဖြစ်ဖြစ်, model-generated ဖြစ်ဖြစ်။ Fail-closed — validate မအောင်မြင်ရင် execute မလုပ်ဘူး။"

### C3. SQLGuard — Security Core (၂ မိနစ်)

**['View read-only SQL' block ကို ချဲ့ပြ]**

> "Answer ရောက်ခင် SQL guardrails ကို ရှင်းပြမယ် — ဒါက 'AI က production database ကို ဘယ်လို ဘေးကင်းအောင် query လုပ်သလဲ' ဆိုတာပါ။
>
> **SQLGuard** က SQL query ကို sqlglot (SQL parser) နဲ့ parse လုပ်ပြီး AST (Abstract Syntax Tree) အဖြစ် စစ်တယ် — regex မဟုတ်ဘူး, real parser။ စစ်တာတွေက —
>
> **Read-only enforcement:**
> - တစ် statement ပဲ ခွင့်ပြု — multiple statements ငြင်း
> - **SELECT only** — INSERT/UPDATE/DELETE/DDL အားလုံး ငြင်း
> - CTE (WITH), UNION, subquery-in-SELECT *, comments (`--`, `/* */`) အားလုံး ငြင်း
> - Function allowlist — aggregate/math/date function ၂၄ ခုပဲ ခွင့်ပြု
> - LIMIT 100 အထိပဲ — clamp လုပ်ထားတယ်
>
> **Sensitive column protection:**
> - `password_hash`, `pin_hash`, `totp_secret`, `refresh_token_hash` — ဒါတွေကို SELECT လုပ်ရင် ငြင်း
> - `SELECT *` — wildcard ကို ငြင်း, column တိုင်း explicit ဖော်ပြရမယ်
>
> **Branch scoping:**
> - Query ထဲ branch filter ပါရမယ် — တစ်မျိုးတည်း: **query ရဲ့ branch_id က authenticated user ရဲ့ branch နဲ့ တူရမယ်**
> - ဒါမှ user က တစ်ခြား branch ရဲ့ data ခိုးကြည့်လို့ မရဘူး
> - Foreign-key path ကတစ်ဆင့် branch table ကို သွားရင်လည်း ခွင့်ပြု (BFS reachability)
>
> **DB-level ကာကွယ်မှု (SQLGuard ထက် အပြင်):**
> - Query တိုင်း **read-only transaction** ထဲမှာ run — DB user ကိုယ်တိုင်က `smartretail_ai_reader` role, superuser/DDL/DML အားလုံး မခွင့်ပြု
> - **5-second statement timeout** — query ကြာရင် kill
> - **Asia/Yangon timezone** သတ်မှတ်ထားတယ်
>
> ဒါကြောင့် AI က data ဖတ်လို့ပဲ ရတယ် — ပြောင်းလဲလို့, ဖျက်လို့, ခိုးလို့ မရဘူး။"

### C4. Write-Intent Refusal (၁ မိနစ်)

**[Optional — demo ချင်ရင်]**

> "Write-intent ကို demo ပြချင်ရင် — 'product အသစ်ထည့်ပေး' လို့ မေးကြည့်ပါ။ System က **Step 1 (intent gate)** မှာပဲ ဖမ််မိပြီး ငြင်းတယ် — 'ဒီ AI chat က database အချက်အလက်တွေကို ဖတ်ရှုမေးမြန်းရန်သာ အသုံးပြုနိုင်ပါတယ်။ ထည့်ခြင်း၊ ပြင်ခြင်း၊ ဖျက်ခြင်း မပြုနိုင်ပါ — ဘာအပြောင်းအလဲမှ မလုပ်ပါ။'
>
> ဒါက SQL တည်းဖြည်းခြင်း **မတိုင်ခင်** ပဲ ရပ်တာ — LLM call 1 ခုပဲ ကုန်တယ်, database ကို တန်းမထိဘူး။"

---

## Part D — Answer ဖတ်ခြင်း (Output Sections)

### D1. Answer Card Structure (၃ မိနစ်)

**[Answer ပြီးသွားရင် live bubble က completed card ပြောင်းသွားတယ်]**

> "Answer ပြီးသွားရင် live bubble က solid border ပြောင်းသွားပြီး **'Worked for MM:SS'** နဲ့ total time ပြတယ်။ Answer card ထဲ section အစဉ်လိုက် ပါတယ် —
>
> **1. 'Question understanding'** — system က မေးခွန်းကို ဘယ်လို နားလည်လဲ ပြတယ် — ဥပမာ 'ယနေ့ ရောင်းအား စုစုပေါင်းကို branch ရဲ့ completed sales ကနေ တွက်ချင်တယ်'။
>
> **2. 'Data retrieval plan'** — query plan ပါ — **'Selected columns'** (ဘယ် column တွေ ယူမလဲ) နဲ့ **'Filter'** (branch filter, date filter) တွေ ပါတယ် — transparency အတွက်။
>
> **3. 'View read-only SQL'** — collapsible block။ System က run ခဲ့တဲ့ actual SQL ကို ပြတယ် — ဒါက audit လုပ်လို့ရအောင်, trust တည်ဆောက်အောင်။ ချဲ့ကြည့်လို့ရတယ်, မချဲ့ချင်လည်း ရတယ်။
>
> **4. 'Data returned from the database'** — database က ပြန်ရတဲ့ table (data grid)။ Column header တွေကို Myanmar လို ပြောင်းပြထားတယ် — ဥပမာ `product_name` → **'ပစ္စည်းအမည်'**, `grand_total` → **'စုစုပေါင်းကျသင့်ငွေ'**။
> - **'12 rows'** လို row count ပါတယ်
> - 50 row ထက် ပိုရင် **'— first 50 rows'** badge + truncated flag ပါတယ်
> - ဘာမှ မတွေ့ရင် **'No matching data was found.'**
>
> **5. 'Findings'** — bullet list — LLM က data ကနေ ရှာဖွေတွေ့ရှိချက်များ (max 8 findings, finding တစ်ခုချင်းစီ 500 chars အထိ)
>
> **6. 'Summary'** — highlighted box (primary border + muted background) — အဖြေရဲ့ အဓိက answer (max 1000 chars)။ **Amounts အားလုံး Kyat** ဖြစ်တယ်။
>
> **7. 'Related questions'** — follow-up suggestion chips — နှိပ်ရင် အဲဒီမေးခွန်းနဲ့ ဆက်မေးလို့ရတယ်။ မေးခွန်း Myanmar ဖြစ်ရင် Myanmar suggestion, English ဖြစ်ရင် English suggestion ပြန်ပေးတယ်။
>
> **8. 'Activity log'** — collapsible — timestamp နဲ့ event စာရင်း (cache_hit, intent_readonly, sql_validated, rows returned စသည်) — debugging/audit အတွက်။"

### D2. Narration Rules (၁ မိနစ်)

> "Answer ပြန်ဖော်ပြတဲ့ narrator ရဲ့ rules —
>
> - Database rows **ပဲ** သုံးပြီး answer လုပ်ရမယ် — **numbers တွေကို မဖန်တီးရ** (hallucination ကာ)
> - Question ရဲ့ **ဘာသာစကားအတိုင်းပဲ** ပြန်ရမယ် — Myanmar question → Myanmar answer
> - Rows အလွတ်ရင် **'no data was found'** လို့ ဖော်ပြရမယ်
> - Amounts ကို Kyat အဖြစ် ဖော်ပြရမယ်
> - LLM အလုပ်မလုပ်ရင် **rule-based fallback** ရှိတယ် — raw rows + header ပဲ ပြတယ် (answer အစား)"
>
> "Row cap က **50 rows** — UI မှာ table ပဲ 50 ပြတယ်, SQL LIMIT က 100 — DB က 100 အထိ ယူလို့ရပေမယ့် UI 50 ပဲ ပြတယ်။"

---

## Part E — Conversation Persistence (၁ မိနစ်)

> "မေးခွန်း/အဖြေ အားလုံးကို database ထဲ သိမ်းထားတယ် —
>
> - **`ai_chat_conversation`** table — conversation တစ်ခုစီ (title က ပထမဆုံးမေးခွန်း, max 160 chars), branch + user ownership ပါ
> - **`ai_chat_message`** table — user/assistant message တစ်ခုချင်းစီ; status: pending → complete/failed; metadata JSONB ထဲ understanding, plan, findings, summary, SQL, rows ≤50 ပါ
>
> **Security အသေးစိတ်:**
> - မေးခွန်းကို **client ကနေ trusted မလုပ်ဘူး** — SSE route က question ကို **database ကနေ ပြန်ဖတ်တယ်** — URL ထဲ spoof လုပ်လို့ မရဘူး
> - Message တစ်ခုကို **တစ်ခါပဲ** process လုပ်လို့ရတယ် (status pending ပဲ accept) — **replay protection**
> - Conversation list က userId + branchId နဲ့ scope — တစ်မျိုးတည်းသော user ရဲ့ conversation ပဲ မြင်ရတယ်
>
> Conversation တစ်ခုကို ပြန်ဖွင့်ရင် metadata ကနေ answer card အပြည့်အစုံ ပြန်တည်ဆောက်တယ် — SQL block, data table, findings, summary အားလုံး ပြန်ပေါ်တယ်။"

---

## Part F — Architecture End-to-End (၂ မိနစ်)

> "Entire flow ကို အကျဉ်းချုပ် —"
>
> "**Browser** → POST conversation/message (DB ထဲ pending) → **GET /api/ai/sse** EventSource → Next.js SSE relay (session check, question DB re-read, model credential forward) → **FastAPI ai-service** `GET /stream/rag` → **TextToSQLJob** (cache → intent gate → tool → full generation, တိုင်း SQLGuard validate) → **read-only DB execute** (5s timeout, Asia/Yangon) → **Narrator** (findings + summary) → SSE frames relay back → Browser renders → assistant message persist (complete)"
>
> "**Auth layers** (၄ ဆင့်):
> 1. Browser → Next.js: session cookie + role check (admin/inventory)
> 2. Next.js → FastAPI: `x-ai-service-token` HMAC compare
> 3. DB: dedicated `smartretail_ai_reader` role — superuser/DDL/DML မခွင့်ပြု
> 4. SQLGuard: AST-level read-only + branch scope validation
>
> "**Provider abstraction**: OpenRouter, OpenCode Zen, OpenCode Console — 3 provider ထောက်ပံ့, fallback chain ရှိတယ်, usage (tokens/cost) track လုပ်တယ်, API key ကို Python side မှာ မသိမ်းဘူး (Next.js က header နဲ့ pass တယ်)။"

---

## Part G — Demo Tips & FAQ (Team Walkthrough)

### G1. Demo Script Tips

> "**Demo အတွက် tips**:
>
> 1. **၇-step progress ကို ရှင်းပြ** — live question မေးပြီး steps တွေ ✓ ဖြစ်သွားတာ ကြည့်ပါ
> 2. **'View read-only SQL' ချဲ့ပြ** — generated SQL ကို ပြပါ (trust + transparency)
> 3. **Data table column header Myanmar translation** ပြ
> 4. **Related questions chip တစ်ခု နှိပ်** — follow-up flow ပြ
> 5. **Write-intent refusal ပြ** — 'product ထည့်ပေး' မေးပြီး ငြင်းခံရတာ ပြ
> 6. **Chat history + New chat** — persistence ပြ
> 7. **Myanmar ↔ English toggle** — header language toggle ကနေ question/answer language ပြောင်းတာ ပြ"
>
> "**Myanmar vs English**: Myanmar question နဲ့ မေးရင် Myanmar suggestion + Myanmar answer, English နဲ့ မေးရင် English — language detect အလိုအလျောက် ဖြစ်တယ်။"

### G2. Supervisor FAQ အတွက်

> "**Supervisor မေးနိုင်တဲ့ မေးခွန်းများ**:
>
> **Q: Text-to-SQL က ဘယ်လို secure လဲ?**  
> A: ၄ ဆင့် — (1) AST-based SQLGuard (sqlglot parser, regex မဟုတ်), (2) read-only DB role, (3) branch scoping validation, (4) 5s timeout + LIMIT clamp. Fail-closed — validate fail ရင် execute မလုပ်ဘူး.
>
> **Q: AI က data ပြောင်းလို့ရမလား?**  
> A: မရဘူး — intent gate write ကို ငြင်း, SQLGuard SELECT-only ပဲ, DB role က DML/DDL မခွင့်ပြု. Triple layer.
>
> **Q: တစ်ခြား branch ရဲ့ data ခိုးကြည့်လို့ရမလား?**  
> A: မရဘူး — SQLGuard က query ရဲ့ branch filter ကို authenticated branch နဲ့ တိုက်ရိုက်စစ်တယ်. FK path ကတစ်ဆင့်သွားရင်လည်း branch anchor ကို ရောက်ရမယ်.
>
> **Q: Hallucination ဘယ်လို ကာလဲ?**  
> A: Narrator prompt က 'Never invent numbers', 'use only structured rows' ပါ. Answer က database rows ကနေပဲ ဖန်တီးရတယ်. SQL + data table ကို UI မှာ ပြထားလို့ user verify လုပ်လို့ရတယ်.
>
> **Q: Performance ဘယ်လိုလဲ?**  
> A: Cache hit → LLM call 0. Common question → pre-written tool (1 call). Full generation → 2 calls. DB timeout 5s. UI မှာ 'Worked for' timer ပြထားတယ်.
>
> **Q: Data ဘယ်လောက် ပြန်ပေးလဲ?**  
> A: Max 50 rows UI မှာ, SQL LIMIT ≤100, question ≤500 chars, findings ≤8, summary ≤1000 chars. DTO over-disclosure မရှိအောင် ကန့်သတ်ထားတယ်."

---

## Part H — Closing (၃၀ စက္ကန့်)

> "အကျဉ်းချုပ် — AI Chat က **natural-language database query** ကို **၄ ဆင့် security** (intent gate, AST SQLGuard, read-only role, branch scoping) နဲ့ ကာကွယ်ထားတယ်။ **Tiered RAG pipeline** (cache → intent → tool → generation) က cost သက်သာပြီး, **SSE streaming** နဲ့ live progress ပြတယ်။ Answer က **SQL, data table, findings, summary** အပြည့်အစုံ transparency နဲ့ ပြတယ် — hallucination မဟုတ်ဘူး, database-backed ဖြစ်တယ်။ ကျေးဇူးတင်ပါတယ် — questions ရှိရင် ဖြေကြားပါ့မယ်။"

---

*Script ends — UI label တိုင်း exact text အတိုင်း ညှိထားသည်။*
