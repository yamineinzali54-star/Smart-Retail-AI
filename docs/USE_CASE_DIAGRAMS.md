# SmartRetailAI Use Case Diagrams

UML use case diagrams of the capabilities available to each application role. Use cases sit inside the SmartRetailAI system boundary; permission-gated actions are annotated where approval depends on the configured role permissions (`discount.approve`, `refund.approve`, `transfer.approve`, `void.approve`, `supplier_return.confirm`). Based on `web-app/docs/FEATURES_ADMIN.md`, `FEATURES_INVENTORY.md`, and `FEATURES_CASHER.md`.

Executable diagrams: [`usecase.drawio`](./usecase.drawio) (one page per role).

## Admin

```mermaid
flowchart LR
    Admin([Admin])
    subgraph System[SmartRetailAI]
        A1((Authenticate and manage own profile))
        A2((Switch branch))
        A3((Manage staff, branches, counters, and permissions))
        A4((Manage catalog, suppliers, customers, and imports))
        A5((Create and approve or reject purchase orders))
        A6((Receive goods and manage GRNs))
        A7((Manage stock, transfers, counts, adjustments, and expiry))
        A8((Manage promotions))
        A9((Manage expenses, budgets, and petty cash))
        A10((Manage chart of accounts and journal entries))
        A11((Operate or supervise POS sessions))
        A12((Void sales and approve sale returns or refunds))
        A13((Review reports and audit logs))
        A14((Manage backups and scheduled jobs))
        A15((Use AI chat, forecasts, and analytics))
        A16((Configure AI models and provider keys))
        A17((Manage notifications, Telegram alerts, and settings))
        A18((Manage shift rosters and attendance reports))
    end
    Admin --> A1
    Admin --> A2
    Admin --> A3
    Admin --> A4
    Admin --> A5
    Admin --> A6
    Admin --> A7
    Admin --> A8
    Admin --> A9
    Admin --> A10
    Admin --> A11
    Admin --> A12
    Admin --> A13
    Admin --> A14
    Admin --> A15
    Admin --> A16
    Admin --> A17
    Admin --> A18
```

## Inventory

```mermaid
flowchart LR
    Inventory([Inventory])
    subgraph System[SmartRetailAI]
        I1((Authenticate and manage own profile))
        I2((Switch branch))
        I3((Manage products, categories, units, and suppliers))
        I4((Import catalog and supplier data))
        I5((Create purchase orders))
        I6((Receive approved orders and record GRNs))
        I7((Record supplier payments))
        I8((Draft supplier returns))
        I9((Confirm supplier returns when permitted))
        I10((View batch stock and expiry))
        I11((Write off expired or damaged stock))
        I12((Create reorder purchase orders))
        I13((Record ground-balance counts))
        I14((Create and receive stock transfers))
        I15((Approve stock transfers))
        I16((Post stock adjustments))
        I17((Use inventory-scoped AI forecasting and reorder analysis))
        I18((Manage notifications and account settings))
        I19((Clock in and clock out attendance))
        I9Note[Requires supplier_return.confirm permission]
        I15Note[transfer.approve permission is enabled by default]
    end
    Inventory --> I1
    Inventory --> I2
    Inventory --> I3
    Inventory --> I4
    Inventory --> I5
    Inventory --> I6
    Inventory --> I7
    Inventory --> I8
    Inventory --> I9
    Inventory --> I10
    Inventory --> I11
    Inventory --> I12
    Inventory --> I13
    Inventory --> I14
    Inventory --> I15
    Inventory --> I16
    Inventory --> I17
    Inventory --> I18
    Inventory --> I19

    I5 -. Admin approval required when order is gated .-> I6
    I9 -. Admin by default .-> I9Note
    I15 -. approval gate .-> I15Note
```

## Cashier

```mermaid
flowchart LR
    Cashier([Cashier])
    subgraph System[SmartRetailAI]
        C1((Authenticate with password or PIN))
        C2((Select counter and open POS session))
        C3((Search products and check availability))
        C4((Build, park, and resume carts))
        C5((Checkout and accept cash, card, or mobile payment))
        C6((Use offline checkout queue and sync))
        C7((View own-session sales and receipts))
        C8((Hand over till using blind count))
        C9((Close POS session and reconcile cash))
        C10((Void a sale in own active session))
        C11((Request permission to void another session sale))
        C12((Create sale return or refund request))
        C13((Apply manual discount when permitted))
        C14((Manage notifications and account settings))
        C11Note[Requires void.approve; Admin by default]
        C12Note[Requires refund.approve; otherwise queued for Admin]
        C13Note[Requires discount.approve; denied by default]
    end
    Cashier --> C1
    Cashier --> C2
    Cashier --> C3
    Cashier --> C4
    Cashier --> C5
    Cashier --> C6
    Cashier --> C7
    Cashier --> C8
    Cashier --> C9
    Cashier --> C10
    Cashier --> C11
    Cashier --> C12
    Cashier --> C13
    Cashier --> C14

    C11 -. permission gate .-> C11Note
    C12 -. approval gate .-> C12Note
    C13 -. permission gate .-> C13Note
```

### Role and permission notes

- Inventory can create purchase orders but cannot approve or reject them. GRN receiving is blocked until required purchase-order approval is complete.
- Inventory transfer approval is enabled by default through `transfer.approve`. Supplier-return confirmation requires `supplier_return.confirm`, which is Admin-only by default.
- Cashier can void sales in their own active session. Voids outside that session, manual discounts, and immediate sale-return approval are permission-gated; without refund approval, a return waits for Admin approval.
- Attendance clock-in/out (`/api/inventory/attendance`) is available to Inventory only; shift rosters and roster schedules are Admin-managed; Admin reviews the attendance report.
- Low-stock and expiry alerts are produced by the scheduled alert scan (`/api/cron/alerts`) and delivered in-app and to Telegram; each user manages their own notification preferences.
- AI access is available to Admin and Inventory with Inventory restricted to inventory-focused capabilities. POS checkout does not depend on the AI service.
