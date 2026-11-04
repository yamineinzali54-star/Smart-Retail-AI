# SmartRetailAI Project Flowchart

This document uses UML-aligned activity/flowchart symbols (ISO-style) to show the main user, API, and scheduled-job paths as implemented in the current source tree:

- Rounded terminals: Start and End
- Parallelograms: user input or displayed output (I/O)
- Diamonds: decisions
- Rectangles: processes
- Cylinders: database roles (web app read/write, AI service read-only)
- Solid arrows: control-flow sequence
- Dotted arrows: a step reads or writes data; they do not add a process step

Executable diagrams: [`webapp.drawio`](./webapp.drawio) and [`aiservice.drawio`](./aiservice.drawio).

```mermaid
flowchart TD
    UserStart([Start]) --> OpenApp[Open SmartRetailAI]
    OpenApp --> Credentials[/Enter username and password or cashier PIN/]
    Credentials --> Authenticated{Credentials valid?}
    Authenticated -- No --> LoginError[/Show login error/]
    LoginError --> UserEnd([End])
    Authenticated -- Yes --> HasTOTP{TOTP enabled?}
    HasTOTP -- Yes --> EnterTOTP[/Enter one-time code/]
    EnterTOTP --> TOTPValid{Code valid?}
    TOTPValid -- No --> LoginError
    TOTPValid -- Yes --> Session[Create authenticated session]
    HasTOTP -- No --> Session
    Session --> LoadScope[Load role, permissions, and branch]
    LoadScope --> Role{User role?}

    Role -- Admin --> AdminMenu[/Choose admin workspace action/]
    Role -- Inventory --> InventoryMenu[/Choose inventory workspace action/]
    Role -- Cashier --> Counter[/Select counter/]

    AdminMenu --> AdminAction{Selected action?}
    AdminAction -- Master data --> MasterData[Manage staff, branches, products, suppliers, and settings]
    AdminAction -- Purchasing --> PurchaseOrder[Review and approve purchase orders]
    AdminAction -- Reports --> Reports[/View dashboards and reports/]
    AdminAction -- AI tools --> AITools[/Open an AI tool/]

    InventoryMenu --> InventoryAction{Selected action?}
    InventoryAction -- Stock --> StockOps[Receive, count, adjust, transfer, or write off stock]
    InventoryAction -- Purchasing --> PurchaseOrder
    InventoryAction -- AI tools --> AITools

    MasterData -. read/write .-> OperationalDB
    MasterData --> UserEnd
    PurchaseOrder --> ReceiveGoods[Receive goods and create stock batches]
    ReceiveGoods -. write .-> OperationalDB
    ReceiveGoods --> UserEnd
    StockOps --> Audit[Record inventory change and audit event]
    Audit -. write .-> OperationalDB
    Audit --> UserEnd
    Reports --> ReportQuery[Read report data]
    ReportQuery -. read .-> OperationalDB
    ReportQuery --> ReportOutput[/Display report/]
    ReportOutput --> UserEnd

    Counter --> OpenSession[Open POS session]
    OpenSession --> SearchProduct[Search products and check branch stock]
    SearchProduct --> Cart[Build or resume cart]
    Cart --> Checkout[Calculate promotions, tax, rounding, and payment]
    Checkout --> Approval{Required approval granted?}
    Approval -- No --> Denied[/Show approval error or queue request/]
    Denied --> Cart
    Approval -- Yes --> SaveSale[Create sale and sale lines]
    SaveSale --> DeductStock[Deduct FEFO-selected batch quantities]
    DeductStock -. write .-> OperationalDB
    DeductStock --> Receipt[/Display receipt/]
    Receipt --> EndPOS{End POS session?}
    EndPOS -- No --> SearchProduct
    EndPOS -- Yes --> CloseSession[Close session and reconcile cash]
    CloseSession -. read/write .-> OperationalDB
    CloseSession --> UserEnd

    AITools --> Feature{Select feature?}
    Feature -- Chat --> ChatQuestion[/Enter business question/]
    ChatQuestion --> ChatSQL[Generate and validate read-only SQL]
    ChatSQL -. read .-> AIReadDB
    ChatSQL --> ChatAnswer[Summarize query results]
    ChatAnswer --> ChatOutput[/Display answer and result rows/]
    ChatOutput --> UserEnd

    Feature -- Forecast --> ForecastQuery[Read branch sales and current stock]
    ForecastQuery -. read .-> AIReadDB
    ForecastQuery --> ForecastCalc[Calculate moving-average demand and reorder quantity]
    ForecastCalc --> ForecastOutput[/Display forecast and reorder suggestions/]
    ForecastOutput --> UserEnd

    Feature -- Market Basket --> BasketQuery[Read completed branch sales]
    BasketQuery -. read .-> AIReadDB
    BasketQuery --> BasketCalc[Find frequently co-purchased products]
    BasketCalc --> BasketOutput[/Display product pairs and bundle drafts/]
    BasketOutput --> SaveDraft{Admin saves a draft?}
    SaveDraft -- No --> UserEnd
    SaveDraft -- Yes --> Draft[Save promotion with draft status]
    Draft -. write .-> OperationalDB
    Draft --> ReviewDraft[Admin reviews draft promotion]
    ReviewDraft --> DraftDecision{Approve promotion?}
    DraftDecision -- Yes --> Activate[Activate promotion]
    DraftDecision -- No --> Discard[Discard draft]
    Activate -. write .-> OperationalDB
    Discard -. write .-> OperationalDB
    Activate --> UserEnd
    Discard --> UserEnd

    Feature -- Ops Alerts --> AlertQuery[Read stock, purchase costs, and sales activity]
    AlertQuery -. read .-> AIReadDB
    AlertQuery --> AlertRules[Apply dead-stock, price-drift, and void/discount rules]
    AlertRules --> AlertOutput[/Display operations alerts/]
    AlertOutput --> UserEnd

    Feature -- Margin Watch --> MarginQuery[Read current stocked products and batch prices]
    MarginQuery -. read .-> OperationalDB
    MarginQuery --> MarginCalc[Calculate weighted cost and margin]
    MarginCalc --> MarginOutput[/Display products below the margin threshold/]
    MarginOutput --> UserEnd

    NightlyStart([Scheduled start]) --> Beat[Celery Beat scheduler]
    Beat --> BranchCodes[/Read configured branch codes/]
    BranchCodes --> NightlyJob{Scheduled job?}
    NightlyJob -- 02:00 Forecast --> NightlyForecast[Run forecast calculation]
    NightlyJob -- 02:05 Basket --> NightlyBasket[Run market-basket analysis]
    NightlyJob -- 02:15 Alerts --> NightlyAlerts[Run operations alert rules]
    NightlyForecast -. read .-> AIReadDB
    NightlyForecast --> NightlyForecastResult[/Return forecast result to worker/]
    NightlyForecastResult --> NightlyEnd([End])
    NightlyBasket -. read .-> AIReadDB
    NightlyBasket --> NightlyBasketResult[/Return basket result to worker/]
    NightlyBasketResult --> NightlyEnd
    NightlyAlerts -. read .-> AIReadDB
    NightlyAlerts --> NightlyAlertsResult[/Return alert result to worker/]
    NightlyAlertsResult --> NightlyEnd

    OperationalDB[(PostgreSQL<br/>Web app role: read/write)]
    AIReadDB[(PostgreSQL<br/>AI service role: read-only)]
```

## Main components

- **Web app (Next.js):** edge auth gate (`proxy.ts`), session cookies + JWT, role/permission checks, branch-scoped workflows, POS, reports, and AI tool pages that relay to the Python AI service with `x-ai-service-token`.
- **Operational database:** shared source of truth for users, sales, purchasing, batch inventory, chat history, promotions, and financial records; accessed through the web app read/write role.
- **AI database access:** the same PostgreSQL database, accessed through a separate read-only role (`smartretail_ai_reader*`) with `SET TRANSACTION READ ONLY` and a 5s statement timeout.
- **Background jobs:** Celery Beat (timezone `Asia/Yangon`) schedules `forecast_build`, `basket_build`, and `ops_alerts` for configured branch codes. Interactive AI pages call the same job types on demand via `POST /jobs/enqueue`; chat uses SSE `GET /stream/rag`.

## AI Service Flowchart

Feature-level view of the Python AI service. Auth is service-token only (web app is trusted); no end-user login. Chat follows a three-tier cost ladder — cache hit (0 LLM calls before narration), one intent call that may select a pre-written SQL tool, or full schema + SQL generation — and streams SSE statuses as each step runs (`checking_intent` → `loading_schema` → `cache_hit` / `tool_matched` / `calling_model` → `validating_sql` → `executing` → `narrating` → `done`).

```mermaid
flowchart TD
    AIStart([Start]) --> Gate{Service token valid?}
    Gate -- No --> AIError[/Return auth error/]
    AIError --> AIEnd([End])
    Gate -- Yes --> Entry{Entry point?}

    Entry -- Chat SSE --> Normalize[Normalize question]
    Normalize --> LoadSchema[Load live schema]
    LoadSchema -. read .-> AIReadDB
    LoadSchema --> CacheKey["Build cache key: branch + schema + Yangon date + question"]
    CacheKey --> CacheHit{SQL cache hit?}
    CacheHit -- No --> Intent["Intent check and tool select (LLM call 1)"]
    CacheHit -- Yes --> HitGuard[Re-validate cached SQL with SQLGuard]
    Intent --> WriteCheck{Intent?}
    HitGuard -- Rejected --> Intent
    HitGuard -- Valid --> Execute[Execute read-only SQL]
    WriteCheck -- write --> Refuse[/Read-only refusal reply/]
    Refuse --> ChatOut[/Stream answer, sql_source, usage/]
    WriteCheck -- read --> ToolCheck{Tool matched?}
    ToolCheck -- No --> Generate["Live schema + SQL generation (LLM call 2)"]
    ToolCheck -- Yes --> Render[Render tool SQL template]
    Render --> ToolGuard{SQLGuard passes?}
    ToolGuard -- No --> Generate
    ToolGuard -- Yes --> Store[Store SQL in cache]
    Generate --> GenGuard{SQLGuard passes?}
    GenGuard -- No --> Diagnose[Explain failure (LLM)]
    GenGuard -- Yes --> Store
    Store --> Execute
    Execute -. read .-> AIReadDB
    Execute --> ExecOK{Query ok?}
    ExecOK -- No --> Invalidate[Drop cached entry]
    Invalidate --> Diagnose
    ExecOK -- Yes --> Rows[Cap rows at 50]
    Rows --> Narrate[Narrate answer (LLM)]
    Narrate --> ChatOut
    Diagnose --> ChatOut
    ChatOut --> AIEnd

    Entry -- On-demand job --> Jobs[Analytics Jobs]
    Jobs --> JobType{Job type?}
    JobType -- Forecast --> Forecast[Forecast: demand and reorder]
    JobType -- Basket --> Basket[Market Basket: co-purchase rules]
    JobType -- Alerts --> Alerts[Ops Alerts: stock, price, abuse]
    JobType -- Margin --> Margin[Margin: thin-margin flags]
    Forecast --> Result[/Return JSON result/]
    Basket --> Result
    Alerts --> Result
    Margin --> Result
    Alerts -. read .-> AIReadDB
    Result --> AIEnd

    Entry -- Celery Beat --> Nightly[Nightly batch by branch]
    Nightly -- 02:00 forecast_build --> NightlyForecast[Build forecast inputs]
    Nightly -- 02:05 basket_build --> NightlyBasket[Build basket inputs]
    Nightly -- 02:15 ops_alerts --> Alerts
    NightlyForecast -. read .-> AIReadDB
    NightlyBasket -. read .-> AIReadDB
    NightlyForecast --> Result
    NightlyBasket --> Result

    AIReadDB[(PostgreSQL<br/>AI read-only role)]
```

## Next.js Web App Flowchart

Feature-level view of the Next.js web app. Session auth + role-based workspaces; every AI feature calls the Python AI service through server API routes with `x-ai-service-token` (POS checkout never touches AI). Chat uses a two-step contract: `POST /api/ai/conversations` (or `.../messages`) saves the pending question, then `GET /api/ai/sse?conversation_id&message_id&model_id` validates session, role, UUIDs, and the saved pending message (401 / 403 / 400 / 404 `CHAT_MESSAGE_UNAVAILABLE`), reserves the selected model (terminal done event `AI_MODEL_UNAVAILABLE`), proxies the upstream AI stream (service down → done event `AI_UNAVAILABLE`; upstream quota → `AI_QUOTA_EXCEEDED`), persists the finished message, and records token usage. Terminal failures always arrive as a single `done` event on an open 200 stream, so the page has one client path; a non-streaming `POST /api/ai/chat` relay for the `rag_answer` job exists as well.

```mermaid
flowchart TD
    WebStart([Start]) --> Auth[Authentication]
    Auth --> Login[Sign in: password, cashier PIN, optional TOTP]
    Login --> Session[Create session and load role]
    Session --> Role{User role?}

    Role -- Admin --> Admin[Admin workspace]
    Role -- Inventory --> Inventory[Inventory workspace]
    Role -- Cashier --> POS[POS workspace]

    Admin --> AdminFeat{Admin features?}
    AdminFeat -- Master data --> Master[Staff, branches, products, suppliers]
    AdminFeat -- Purchasing --> PO[Purchase orders and GRN]
    AdminFeat -- Reports --> Reports[Dashboards and reports]
    AdminFeat -- Promotions --> Promos[Review and activate promotions]
    AdminFeat -- AI tools --> AI[AI tools]

    Inventory --> InvFeat{Inventory features?}
    InvFeat -- Stock --> Stock[Receive, count, adjust, transfer, write-off]
    InvFeat -- Purchasing --> PO
    InvFeat -- AI tools --> AI

    POS --> POSFeat{POS features?}
    POSFeat -- Sell --> Checkout[Cart, checkout, receipt]
    POSFeat -- Close --> Close[Close session and reconcile cash]

    AI --> AIRole{Admin or inventory?}
    AIRole -- No --> Forbidden[/Forbidden/]
    Forbidden --> WebEnd([End])
    AIRole -- Yes --> AIType{AI feature?}

    AIType -- Chat --> SelectModel[Select AI model]
    SelectModel --> SaveQuestion[Save pending question]
    SaveQuestion -. write .-> WebDB
    SaveQuestion --> OpenStream[/Open EventSource stream/]
    OpenStream --> RelayGate{Session, IDs, and pending message valid?}
    RelayGate -- No --> StreamErr[/HTTP 401, 403, 400, or 404/]
    StreamErr --> WebEnd
    RelayGate -- Yes --> Reserve{Model reserved?}
    Reserve -- No --> QuotaFail["Stream ends: model unavailable"]
    QuotaFail --> WebEnd
    Reserve -- Yes --> Proxy[Proxy AI service SSE]
    Proxy -- Service down or quota --> Unavail["Stream ends: service unavailable"]
    Unavail --> WebEnd
    Proxy --> Events["Stream events: status, SQL, rows, answer, suggestions"]
    Events --> Persist[Persist message and record usage]
    Persist -. write .-> WebDB
    Persist --> WebEnd

    AIType -- Forecast --> Forecast[Forecast and reorder ideas]
    AIType -- Basket --> Basket[Bundle drafts, admin saves promotion]
    AIType -- Alerts --> Alerts[Operations alerts]
    AIType -- Margin --> Margin[Low-margin product watch]

    Master -. rw .-> WebDB
    PO -. rw .-> WebDB
    Stock -. rw .-> WebDB
    Promos -. rw .-> WebDB
    Reports -. r .-> WebDB
    Checkout -. rw .-> WebDB
    Close -. rw .-> WebDB
    Basket -. rw .-> WebDB
    Margin -. r .-> WebDB

    Forecast -. call .-> AISvc[(AI Service)]
    Basket -. call .-> AISvc
    Alerts -. call .-> AISvc
    Margin -. call .-> AISvc
    Proxy -. call .-> AISvc

    Forecast --> WebEnd
    Basket --> WebEnd
    Alerts --> WebEnd
    Margin --> WebEnd
    Master --> WebEnd
    PO --> WebEnd
    Stock --> WebEnd
    Reports --> WebEnd
    Promos --> WebEnd
    Checkout --> WebEnd
    Close --> WebEnd

    WebDB[(PostgreSQL<br/>Web app read/write role)]
```
