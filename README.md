# Payment Service

> **As a company admin, I need to sign up, register my business, and pay for my plan so that my account is activated
> immediately on success and recovers safely from payment failures or delayed confirmations.**

A focused slice of a self-serve B2B onboarding flow, going deep on one integration: **Stripe payments**.

Built one small task per commit; the task list is in [docs/EXECUTION-PLAN.md](docs/EXECUTION-PLAN.md).

## Stack

NestJS · PostgreSQL · TypeORM (migrations) · JWT · Stripe (PaymentIntents, with a mock provider for running without keys) ·
React (Vite) · Docker Compose · Swagger

## Running it

### Everything at once (Docker)

Requires Docker Desktop. From the repository root:

```bash
docker compose up -d --build   # database + API + web app; the first build takes a few minutes
docker compose ps              # wait until every service says (healthy)
```

| What | Where |
|---|---|
| The web app (register, pay, activation) | http://localhost:8080 |
| Swagger UI / OpenAPI JSON | http://localhost:3000/docs · http://localhost:3000/docs-json |
| The API directly | http://localhost:3000 (the web app reaches it as `/api/*`) |

It needs **no configuration**: without Stripe keys it uses the built-in mock provider, and the payment screen shows a demo
panel (pay, decline, 3-D Secure, slow bank, lost webhook, provider outage). To use real Stripe, see "Real Stripe" below.
`docker compose down` stops everything (data is kept); `docker compose down -v` also wipes the database.

### For development

Requires Node.js 22.12 or newer.

```bash
docker compose up -d postgres   # from the repository root: just the database (see "Database" below)
cd backend
npm install
cp .env.example .env   # required: DATABASE_URL has no default (see "Configuration")
npm run start:dev      # API on http://localhost:3000  (try GET /health)
                       # Swagger UI: http://localhost:3000/docs   (raw OpenAPI: /docs-json)
npm test               # unit tests: fast, need no database
npm run test:e2e       # end-to-end tests: need the database; each file uses its own throw-away DB
npm run lint           # type-check source and tests

cd ../frontend
npm install
npm run dev            # web app on http://localhost:5173, forwarding /api to the API on port 3000
npm test               # frontend tests (Vitest + Testing Library)
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

### Webhooks

The provider tells us a payment changed by calling `POST /webhooks/payments` (public: the **signature** is the credential,
checked over the exact bytes received). A webhook is only a *trigger*: we never trust what it says, we ask the provider for the
payment's real current state. So a duplicate, late, out-of-order or forged message cannot mislead us. An event is marked
handled only after everything succeeded, so if something fails the provider's retry is processed, not skipped.

### If a webhook is lost

Webhooks are delivered at-least-once *usually*, which is not good enough for money. So once a minute (`RECONCILE_INTERVAL_MS`)
a job asks the provider about open payments that have been quiet for 2 minutes and applies the real state through the same
code path as a webhook. A customer who paid is therefore activated within a few minutes even if the webhook never arrives.
It only looks at payments created in the last 24 hours (older ones are abandoned checkouts), oldest-synced first, 50 at a time.
One failing payment, or a provider outage, never stops the others; the next run tries again.

### Trying it from Swagger (mock provider)

Open `/docs`, register, click **Authorize** and paste the token, then:

1. `POST /payments`, and copy `payment.providerRef`
2. `POST /dev/mock-payments/{providerRef}/simulate` with `{"outcome": "succeed"}` (or `decline`, `require_action`, `processing`, `cancel`)
3. `GET /onboarding/status` shows `ACTIVE` about a second later

Failure drills: `{"outcome": "succeed", "deliverWebhook": false}` simulates a **lost webhook** (the account activates when the
customer resumes checkout via `POST /payments`), and `POST /dev/mock-payments/outage` switches the provider "off".
These dev endpoints answer `404` when `NODE_ENV=production`.

### Choosing the payment provider

`PAYMENT_PROVIDER` selects it at startup (the design is in `docs/adr/0005-payment-provider-port.md`):

| Value | Needs | Use for |
|---|---|---|
| `mock` (default) | nothing | development and tests. Refused when `NODE_ENV=production`: its webhook "signature" is public, so anyone could fake a payment |
| `stripe` | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | real payments (use Stripe's **test mode** keys while developing) |

`GET /checkout-config` (public) tells the browser which provider is active, Stripe's *publishable* key (designed to be public;
never the secret key) and the price, which is what a payment screen needs.

### Real Stripe (test mode)

You need a Stripe account (no card or business verification is needed for test mode) and its **test** keys from the
dashboard (Developers → API keys). Stripe cannot reach your laptop, so the **Stripe CLI** receives its webhooks and forwards
them to the API. The CLI's signing secret is stable for your account, so you fetch it once.

**With Docker** (the CLI runs as an opt-in container):

```bash
cp .env.example .env     # root .env, git-ignored. Uncomment and fill in PAYMENT_PROVIDER, STRIPE_SECRET_KEY and
                         # STRIPE_PUBLISHABLE_KEY. Leave STRIPE_WEBHOOK_SECRET for the next step.
docker compose run --rm stripe-cli listen --print-secret   # prints whsec_...: put it in .env as STRIPE_WEBHOOK_SECRET
docker compose --profile stripe up -d --build
```

Open http://localhost:8080, register, and pay with Stripe's test card `4242 4242 4242 4242` (any future expiry, any CVC).
Other test cards: `4000 0000 0000 0002` is declined, and `4000 0027 6000 3184` asks for 3-D Secure. The account activates
about a second after Stripe confirms the payment.

**Without Docker** (development): put the same three `STRIPE_*` settings and `PAYMENT_PROVIDER=stripe` in `backend/.env`, then
run the Stripe CLI on your machine (`npm i -g stripe`, or see Stripe's install page) next to the API:

```bash
stripe listen --api-key sk_test_... --forward-to localhost:3000/webhooks/payments
```

A real deployment would instead register `https://<your-host>/webhooks/payments` as a webhook endpoint in the Stripe dashboard
for the `payment_intent.*` events, and use that endpoint's own signing secret.

The adapter's logic is covered by tests that run offline. To also run the shared provider contract against Stripe's test mode
(this creates test payments):

```bash
cd backend
STRIPE_TEST_SECRET_KEY=sk_test_... npm test -- stripe-payment.provider.contract
```

A live key (`sk_live_...`) is refused by that test.

## Logs and privacy

Logs are a data-leak surface, so they are tested like one. An end-to-end "canary" test (`backend/test/log-safety.e2e-spec.ts`)
runs registrations, payments, webhooks, outages and several failures with all logging on, and checks that no email, name,
company detail, token, signing secret or payment client secret appears anywhere in the output. It already caught one real
leak: TypeORM's error logging prints a failed query *with its parameter values*, so it is switched off (the failure is still
logged by the exception filter, with its stack and without the parameters). Error logs carry the request id, and payment logs
carry the payment id.

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
