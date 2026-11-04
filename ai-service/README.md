# SmartRetailAI AI service

This Python service provides the AI and analytics jobs used by the Next.js
application. It is built with FastAPI and keeps database access read-only.
The web app owns user authentication, AI model configuration, and saved chat
history; the service receives authenticated requests from the web server.

## Features

- **AI chat (RAG):** turns a question into a branch-scoped, read-only SQL
  query, validates it with `SQLGuard`, returns up to 50 rows, and creates
  findings, a summary, and suggested follow-up questions.
- **Forecasting:** calculates demand forecasts and reorder suggestions from
  branch sales history.
- **Basket analysis:** finds product associations and drafts promotion ideas.
- **Operations alerts:** reports dead stock, supplier cost changes, and
  cashier void/discount outliers using rules and SQL.
- **Margin analysis:** flags products below a target margin. The service never
  changes a product's price.
- **Background processing:** includes Celery nightly jobs and a Redis Streams
  consumer for jobs submitted to the service's job stream.

Chat requests require the provider, model, and credential selected in the web
app's Chat UI; both SQL generation and answer narration use that same model.
OpenRouter, OpenCode Zen, and OpenCode Console inference use their own matching
endpoints and credentials.
The environment-based OpenRouter settings remain for non-chat LLM jobs such as
forecast narration.

## Requirements

- Python 3.10 or newer
- PostgreSQL shared with the web app
- Redis for Celery workers, Beat, and the Redis Streams consumer
- An OpenRouter API key for service-configured non-chat LLM jobs; chat uses the
  model and credential selected in the web app

## Local setup

Run these commands from `ai-service/`.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `.env` before starting the service. Configure the service token and
database URL for functional requests; set provider and Redis settings for the
components you plan to run:

- `AI_SERVICE_TOKEN`: a long random secret. Set the identical value in
  `../web-app/.env.local`.
- `AI_DATABASE_URL`: a PostgreSQL URL for the dedicated read-only role.
- `OPENROUTER_API_KEY`: needed when service-configured LLM calls should use
  OpenRouter.
- `REDIS_URL`: needed when running Celery or the Redis Streams consumer.

Do not use the web app's owner `DATABASE_URL` for `AI_DATABASE_URL`. The old
`smartretail_ai_reader` role may have been created without a password. Neon
cannot reset a password for a SQL-created role that has no password, and the
SQL Editor may not allow altering or dropping it. Create a separate passworded
reader login instead; the service accepts it after checking its effective
privileges:

1. Generate a new private password of at least 32 alphanumeric characters.
   For example, in PowerShell:

   ```powershell
   $bytes = New-Object byte[] 24
   $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
   $rng.GetBytes($bytes)
   $readerPassword = [BitConverter]::ToString($bytes).Replace('-', '').ToLower()
   $readerPassword
   ```

2. In `ai_readonly_role.sql`, replace
   `REPLACE_WITH_A_NEW_32_PLUS_CHARACTER_PASSWORD` with that value.
3. Run the complete script once in Neon SQL Editor against the same database
   used by `web-app`. It creates `smartretail_ai_reader_login` alongside the
   original role and grants it read-only access; it does not drop or modify the
   original role.
4. Update `AI_DATABASE_URL` in this service's `.env` to use the new username
   `smartretail_ai_reader_login` and the same password. Keep the existing Neon
   host/database and `sslmode=require`, then restart the AI service. Do not
   commit the edited SQL file or share the password.

Do not create the reader through the Neon Console: Neon-created roles receive
`neon_superuser` membership. The web app owner `DATABASE_URL` must never be used
as `AI_DATABASE_URL`.

`app/config.py` loads `.env` from the current working directory. The checked-in
[`.env.example`](.env.example) lists all supported settings, including model
IDs and the comma-separated nightly branch codes. Request and spending limits
are read from the configured provider. Never commit `.env` or expose
`AI_SERVICE_TOKEN` or provider keys.

## Run the API

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Check the liveness endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

`/health` is intentionally public for liveness checks. Every other endpoint
requires the `x-ai-service-token` header. The web app sends it server-to-server
using `AI_SERVICE_URL` and `AI_SERVICE_TOKEN`.

## HTTP API

| Route | Method | Purpose |
| --- | --- | --- |
| `/health` | GET | Public liveness response |
| `/jobs` | GET | List registered job types |
| `/jobs/enqueue` | POST | Run a registered job synchronously and return its result |
| `/stream/rag` | GET | Stream the chat query and answer steps as Server-Sent Events |

Example synchronous request (replace the branch ID and token):

```powershell
# Set AI_SERVICE_TOKEN in this PowerShell session before making the request.
$headers = @{ "x-ai-service-token" = $env:AI_SERVICE_TOKEN }
$body = @{
  job_type = "rag_answer"
  branch_id = "00000000-0000-0000-0000-000000000000"
  params = @{ question = "What were today's total sales?" }
} | ConvertTo-Json -Depth 5
Invoke-RestMethod http://127.0.0.1:8000/jobs/enqueue -Method Post -Headers $headers -ContentType "application/json" -Body $body
```

`/stream/rag` accepts `question` and `branch_id` query parameters. Optional
headers let the trusted web app supply the selected model configuration:
`x-ai-model-provider`, `x-ai-model`, `x-ai-api-key`, and
`x-ai-max-tokens`. Do not put credentials in the query string. Stream events
include status updates, question understanding, plan, SQL, rows, findings,
suggestions, and a terminal `done` event.

The registered job types are `ops_alerts`, `forecast`, `forecast_build`,
`promotion_suggest`, `basket_build`, `price_optimize`, `rag_query`, and
`rag_answer`. The synchronous `/jobs/enqueue` route executes in the API
process; the Redis Streams consumer is a separate worker path.

## Workers and schedules

Start a Celery worker and scheduler in separate terminals:

```powershell
celery -A app.workers.celery_app:celery worker -l info
celery -A app.workers.celery_app:celery beat -l info
```

Beat schedules forecast, basket, and alert jobs at 2:00, 2:05, and 2:15 AM
Asia/Yangon for every branch code in `NIGHTLY_BRANCH_CODES` (default `YGN`).
The scheduled jobs resolve each branch code against the database.

The Redis Streams consumer runs separately:

```powershell
python -m app.workers.consumer
```

It reads the configured job stream, dispatches through the same job registry,
publishes results to the result stream, and acknowledges processed messages.
It requires Redis and a configured database. Celery/Redis imports are lazy so
the API and unit tests can run without a broker.

## Data and safety boundaries

- The database connection must use the dedicated read-only role. The helper
  opens read-only transactions with a statement timeout.
- Chat SQL is limited to allow-listed tables and validated for branch filters,
  read-only operations, and a row limit before execution.
- Chat results are capped at 50 rows. The web app persists conversation
  messages and their answer metadata in its own database.
- `promotion_suggest` creates drafts only; an authorized user activates them
  in the web app.
- `price_optimize` only returns margin flags. It cannot update prices.
- Request-rate and spending limits are enforced by the configured AI provider;
  this service does not impose its own daily request quota.
- OpenRouter requests use the configured zero-data-retention and data
  collection settings. Provider policies and availability can change; check
  the provider's current terms before sending sensitive business data.

## Tests

The pytest suite uses fakes/stubs so it does not need a live database, Redis,
or provider credentials:

```powershell
pytest
```
