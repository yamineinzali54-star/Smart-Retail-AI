# SmartRetailAI web app

SmartRetailAI is a branch-scoped retail ERP and point-of-sale application.
The web app uses Next.js App Router, PostgreSQL, Drizzle ORM, and server-side
JWT sessions. It includes inventory and purchasing workflows, POS checkout,
accounting, reports, AI tools, and role-specific workspaces.

## Main areas

- **Admin:** staff, branches, counters, permissions, purchasing approval,
  promotions, expenses, petty cash, general ledger, reports, backups, and
  operational settings.
- **Inventory:** products, categories, units, suppliers, purchase orders,
  receiving, stock, expiry, adjustments, transfers, and reorder workflows.
- **Cashier:** POS sessions, checkout, parked carts, handovers, receipts, and
  sale returns.
- **AI:** read-only sales and inventory chat with saved conversation history,
  forecasting, basket analysis, alerts, and margin review. Admins configure
  OpenRouter, OpenCode Zen, and OpenCode Console credentials under `/ai-models`.

More detail is in the [admin](docs/FEATURES_ADMIN.md),
[inventory](docs/FEATURES_INVENTORY.md), [cashier](docs/FEATURES_CASHER.md),
and [API endpoint](docs/API_ENDPOINTS.md) guides. Sample CSV files and their
import notes are in [`docs/dataset`](docs/dataset/README.md).

## Requirements

- Node.js 20.9 or newer (required by the installed Next.js version)
- npm
- PostgreSQL (Neon is supported)
- Git
- Python and Redis only if you are running the separate AI service or its
  background workers; see [`../ai-service/README.md`](../ai-service/README.md)

Docker is not required for the web app.

## Local setup

Run these commands from `web-app/`.

### 1. Install dependencies

```bash
npm ci
```

### 2. Configure environment

Copy [`.env.example`](.env.example) to `.env.local` and set the real database
URL and a strong authentication secret.

```powershell
Copy-Item .env.example .env.local
```

Required values:

```dotenv
DATABASE_URL=postgresql://<user>:<password>@<host>/<database>?sslmode=require
AUTH_SECRET=<long-random-secret-at-least-32-characters>
```

For AI features, also set `AI_SERVICE_URL` and `AI_SERVICE_TOKEN`. The token
must match `AI_SERVICE_TOKEN` in `ai-service/.env`. The Python service must be
running at that URL. AI model provider keys are configured by an admin in the
app; do not put them in this file.

Other optional settings are documented in `.env.example`, including Redis
rate limiting, token lifetimes, Telegram notifications, the internal alert
and backup schedules, and the public receipt URL. Keep secrets server-side;
never add a `NEXT_PUBLIC_` prefix to a secret. `NEXT_PUBLIC_APP_URL`, if set,
is a public URL used when building receipt links.

Do not commit `.env.local`. If Redis is unavailable, rate limiting uses its
in-memory fallback. Production deployments should use a shared Redis service
when rate limits must be consistent across multiple app instances.

### 3. Apply the database migrations

```bash
npm run db:migrate
npm run db:seed
```

The seed is safe to rerun and creates the initial `YGN` branch, default
permissions, chart of accounts, counters, and local development users. The
seed passwords are for local setup only; change them after first login and
never reuse them in a deployed environment.

Local seed logins:

| Role      | Username     | Password        |
| --------- | ------------ | --------------- |
| Admin     | `admin1`     | `Admin@123`     |
| Inventory | `inventory1` | `Inventory@123` |
| Cashier   | `cashier1`   | `Cashier@123`   |

Three PostgreSQL row-level security scripts are maintained outside Drizzle's
migration journal. Apply them manually after the journaled migrations:

```bash
psql "$DATABASE_URL" -f db/migrations/0004_rls_master_data.sql
psql "$DATABASE_URL" -f db/migrations/0005_rls_immutable_master_data.sql
psql "$DATABASE_URL" -f db/migrations/0015_rls_remaining_tables.sql
```

The application still enforces authorization in its API routes. These RLS
policies provide additional protection for direct database access.

### 4. Start the web app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `/dashboard` routes
authenticated users to their role-specific workspace.

For the AI chat and AI tools, start the Python service separately. Follow its
[setup guide](../ai-service/README.md); its token must match the web app's
`AI_SERVICE_TOKEN`.

## Common commands

```bash
npm run dev               # Development server
npm run build             # Production build
npm start                  # Serve the production build
npm run lint               # ESLint
npm run typecheck          # TypeScript check (tsc --noEmit)
npm run test:unit          # Vitest unit suite
npm run test:integration   # Vitest integration suite
npm run test:e2e           # Playwright browser suite
npm test                   # All three test suites
npm run db:generate        # Generate a Drizzle migration from schema changes
npm run db:migrate         # Apply journaled Drizzle migrations
npm run db:seed            # Idempotent development seed
```

Integration and browser tests should use a disposable database. The test
configuration reads `.env.test`; set `TEST_DATABASE_URL` to an isolated test
database before running them. Playwright starts Next.js on port 3100 by
default. Apply migrations and run the seed against that test database before
the integration suite. Playwright's global setup runs the seed itself. Do not
point tests at production or a database with important data.

## Database workflow

1. Edit the schema in `db/schema.ts`.
2. Generate a migration with `npm run db:generate`.
3. Review the SQL and migration journal entry.
4. Apply it with `npm run db:migrate` and update seed data if needed.
5. Apply any corresponding manual RLS changes and test with the intended DB
   roles.

Queries and writes are scoped to the signed-in user's branch by the API.
Amounts use PostgreSQL `numeric` values and Decimal.js for arithmetic; dates
are stored as UTC timestamps unless a column is date-only.

## AI integration

The web app owns AI API keys, model configuration, usage limits, and chat
history. Provider credentials are encrypted at rest using `AUTH_SECRET`.
During chat, the server reserves an enabled model, sends its provider/model
configuration to the Python service over the private service connection, and
relays Server-Sent Events to the browser. Conversations and result metadata
are stored in the web app database and scoped to both the user and branch.

The Python service connects to the same PostgreSQL database using a dedicated
read-only account. Chat SQL is validated for allowed tables, branch scope, and
read-only behavior before execution. AI availability is independent from POS
checkout; checkout does not call the AI service.

## Scheduling and backups

On a long-running Node.js host, `instrumentation.ts` starts the internal
scheduler by default. It runs the alert scan at 8:00 AM Myanmar time and the
local disk backup at 2:00 AM Myanmar time. Set `INTERNAL_CRON_ENABLED=false`
when an external scheduler triggers `/api/cron/alerts`; configure
`INTERNAL_BACKUP_ENABLED` separately if the local backup job should be
disabled. In-memory timers are not a durable scheduler on serverless hosts.

The PostgreSQL `pg_cron` setup under `db/cron` is for self-hosted PostgreSQL;
Neon does not support that setup. See the SQL file comments before using it.
Backups contain sensitive data and password hashes. Restrict access to the
configured `BACKUP_DIR` and retention files.

## Security overview

- Passwords are hashed; access tokens are short-lived and refresh tokens
  rotate. Reuse detection revokes sessions.
- TOTP two-factor authentication is optional per user.
- API handlers check the user's session, role, branch, and action permissions.
- Branch-scoped data is filtered in application queries; RLS adds protection
  for direct DB access.
- The AI service uses a separate database role with read-only privileges.
- Card PAN data is not stored; card checkout records only the last four digits.
- Keep `.env.local`, `.env.test`, provider keys, service tokens, and database
  credentials out of source control and logs.

## Stack

Next.js 16 App Router, React 19, TypeScript, PostgreSQL, Drizzle ORM,
postgres.js, custom JWT sessions (`jose`), bcryptjs, TOTP (`otplib`), Redis-
optional rate limiting, and shadcn/ui. The Python AI service uses FastAPI,
Pydantic Settings, psycopg, OpenRouter-compatible APIs, Redis, and Celery.
