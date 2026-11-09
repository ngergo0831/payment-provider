# Payment Service

> **As a company admin, I need to sign up, register my business, and pay for my plan so that my account is activated
> immediately on success and recovers safely from payment failures or delayed confirmations.**

A focused slice of a self-serve B2B onboarding flow, going deep on one integration: **Stripe payments**.

**Status:** work in progress, built one small task per commit. See [docs/EXECUTION-PLAN.md](docs/EXECUTION-PLAN.md) for the
task list and current progress.

## Planned stack

NestJS · PostgreSQL · TypeORM (migrations) · JWT · Stripe (PaymentIntents, with a mock provider for running without keys) ·
React · Docker Compose · Swagger

## Running it

Requires Node.js 22.12 or newer. Instructions grow as each part is built.

```bash
docker compose up -d   # from the repository root: the database (see "Database" below)
cd backend
npm install
cp .env.example .env   # required: DATABASE_URL has no default (see "Configuration")
npm run start:dev      # API on http://localhost:3000  (try GET /health)
                       # Swagger UI: http://localhost:3000/docs   (raw OpenAPI: /docs-json)
npm test               # unit tests: fast, need no database
npm run test:e2e       # end-to-end tests: need the database; each file uses its own throw-away DB
npm run lint           # type-check source and tests
```

`GET /health` answers `200` when the database is reachable and `503` when it is not.

## Database

PostgreSQL runs in Docker (requires Docker Desktop). From the repository root:

```bash
docker compose up -d     # start; first run downloads the image
docker compose ps        # STATUS shows "(healthy)" once it accepts connections (about 10 s)
docker compose down      # stop; data is KEPT in the named volume
docker compose down -v   # stop AND delete all data (fresh database next time)
```

Defaults for development: user `payments`, password `payments`, database `payments`, on `127.0.0.1:5432` (this machine only,
not the network). To change them, copy `.env.example` to `.env` next to `docker-compose.yml` **before the first start**:
the user, password and database are applied only when the volume is first created.

## Configuration

Settings come from environment variables, validated at startup (`backend/src/config/`). If anything is invalid the app
prints every problem and exits instead of starting half-configured.

```bash
cd backend
cp .env.example .env   # required once: DATABASE_URL has no default
```

Real environment variables override values in `.env`. Each setting is documented in `backend/.env.example`.

### Migrations

The schema is owned by migrations only (`synchronize` is off). Pending migrations are applied automatically when the app
starts. From `backend/`: `npm run migration:show` lists them, `migration:run` applies them, `migration:revert` undoes the
last one.

## Registering a company

`POST /auth/register` creates a company and its first admin in one step. There is no password or login in this slice.
The company starts as `PENDING_PAYMENT` and becomes `ACTIVE` once it has paid. Try it in Swagger (`/docs`), where the
request is pre-filled; change the email to register again.

```bash
curl -X POST http://localhost:3000/auth/register -H 'content-type: application/json' -d '{
  "email": "jane.doe@acme.example",
  "fullName": "Jane Doe",
  "company": { "name": "Acme Ltd", "country": "HU", "taxId": "HU12345678" }
}'
```

Emails are stored trimmed and lower-case (a second registration differing only in case is a `409`). Unknown fields
and invalid values return `422` listing every problem; see "Error format" below.

## Authentication

Registration returns an `accessToken` (a JWT, valid for `JWT_EXPIRES_IN`, 24 h by default). Send it on protected
endpoints as `Authorization: Bearer <token>`. In Swagger, click **Authorize** and paste it.

```bash
curl http://localhost:3000/onboarding/status -H "Authorization: Bearer <accessToken>"
# { "company": { "name": "Acme Ltd", "status": "PENDING_PAYMENT", ... }, "nextStep": "PAYMENT" }
```

- **Which company?** Always the one in the token. Endpoints take no company id, so a caller cannot ask for another company's data.
- **A missing, malformed, expired, forged or wrongly signed token** all return `401` in the standard error shape.
- Tokens are *signed*, not encrypted: anyone can read the claims (user id, company id, role), but nobody can change them.
- There is no login or refresh in this slice: losing the token means registering again.
- `JWT_SECRET` is required (32+ characters). The example in `.env.example` is public and is refused when `NODE_ENV=production`.

## Paying

Both endpoints need the `Authorization: Bearer <accessToken>` header; the company always comes from the token.

- `POST /payments` **starts or resumes** the company's payment and returns what the browser needs to pay (`clientSecret`).
  Calling it again is always safe: a double click, a page reload, a retry after a declined card or after the provider
  was down all return the same open payment. A company never has two open payments.
- `GET /payments/{id}` returns the stored status (cheap to poll). Another company's payment is a `404`.

The price comes from configuration (`PLAN_PRICE_MINOR`, `PLAN_CURRENCY`; default 49.00 USD) and is validated at startup.
If the payment provider is down the answer is `503 PAYMENT_PROVIDER_UNAVAILABLE` ("nothing was charged"), and the next call
resumes the same payment. Starting a payment does not activate the account; that happens after the provider confirms it.

### How a payment activates the account

1. The provider reports the payment as paid, and our side notices it. Saving that status also **queues a "payment
   succeeded" message in the same database transaction** (the outbox, `docs/adr/0006-transactional-outbox.md`).
2. A small timer (`OUTBOX_POLL_INTERVAL_MS`, 1 s by default) delivers queued messages. The company becomes `ACTIVE`.
3. If delivery fails, the error is recorded and it is retried after a growing delay (5 s, 10 s, 20 s, ... at most 5 minutes
   apart), up to 10 attempts. A message that still fails stays in the `outbox_messages` table, with its error, for a person.

Delivery is at-least-once, so activation is idempotent: delivering the same message twice changes nothing.

Currently only a built-in mock provider is available (see `docs/adr/0005-payment-provider-port.md`).

## Error format

Every failing request returns the same JSON shape. Clients branch on `code`, never on `message`.

```json
{
  "statusCode": 422,
  "code": "VALIDATION_FAILED",
  "message": "Request validation failed",
  "details": [{ "field": "email", "messages": ["email must be an email"] }],
  "requestId": "b3f1c5a2-0c52-4a35-9f43-1d4b2c3a9a10",
  "timestamp": "2026-11-09T12:00:00.000Z"
}
```

`details` appears for validation errors only. `requestId` is also returned in the `x-request-id` header and appears in the
server logs; send your own `x-request-id` to correlate across systems. Unexpected errors always return a generic 500: the
real cause is logged server-side and never sent to the client.

## Repository contents

| Path | Purpose |
|---|---|
| `assignment.txt` | The original take-home assignment |
| `docs/EXECUTION-PLAN.md` | Step-by-step build plan, one task per commit |
| `docs/adr/` | Architecture decision records: why the code is shaped the way it is |
| `backend/` | NestJS API |
