# Execution plan

Step-by-step build of the onboarding + Stripe payments service, one small task per commit.

> **As a company admin, I need to sign up, register my business, and pay for my plan so that my account is activated
> immediately on success and recovers safely from payment failures or delayed confirmations.**

Stack: NestJS · PostgreSQL · TypeORM (explicit migrations) · JWT · Stripe (PaymentIntents, one-time 49.00 USD fee, mock provider fallback) · React · Docker Compose · Swagger.

## Scope

**The payment module is the product.** Registration is deliberately thin: a form with a "Fill sample data" helper,
no password and no login. It exists only to give payments a real, authenticated, tenant-scoped company to charge.

| Area | Decision |
|---|---|
| Registration / auth | Minimal: `POST /auth/register` stores company + admin and returns a JWT (24 h for demo convenience). No password, no login, no hashing. |
| Payment module | Built to a high bar (see "Payment module quality bar") |
| Frontend | Minimal 3 steps: register (with sample data helper), pay, activation status |
| Out of scope | Login/password reset, email verification, refresh tokens, RBAC, subscriptions, invoices/tax |

### Payment module quality bar

Included:

- **Provider port** with two adapters (Stripe, Mock) that pass the **same contract test suite**.
- **Money value object** aware of currency decimals (USD 2, JPY 0), amounts always integer minor units.
- **Payment state machine**: illegal transitions can never corrupt state; `FAILED` is retryable on the same intent.
- **Idempotency at three levels**: client `Idempotency-Key` header, provider idempotency key, webhook event inbox.
- **Concurrency safety**: one open payment per company (partial unique index) and optimistic locking on updates, because webhook, reconciliation and "resume checkout" can touch the same payment at once.
- **Webhooks**: signature over raw bytes, inbox table, events are triggers (state is re-read from the provider).
- **Reconciliation job** for lost webhooks.
- **Transactional outbox**: the status change and the "payment succeeded" message are written in one database transaction, then delivered to onboarding by a dispatcher with retries. Removes the "paid but activation lost" failure class.
- **Cancel payment** for abandoned checkouts.
- **Safe logging**: payment id and request id on every line, no PII or card data.
- **ADRs** (`docs/adr/`) for each major decision, written in the task that makes the decision.

Documented as future work, not built: audit trail table, circuit breaker / backoff on provider calls, refunds and disputes.
(Basic resilience is still present: provider timeout, SDK retries that are safe because of idempotency keys.)

## How we work

Every task follows the same loop:

1. **State the goal** and what will be learned from it.
2. **Implement only that task**, with its tests in the same change.
3. **Run it and show it working.** Explain the key decisions and the "why".
4. **Stop and wait for a go-ahead.** After that, make the commit.

Rules:

- One task = one commit, with a Conventional Commit message (`feat:`, `chore:`, `test:`, `docs:`).
- Commits go straight to `main` (solo work). Nothing is pushed unless asked.
- Every commit leaves the project runnable.
- One concern per task. Each table gets its own migration, in the same task as the code that uses it.
- Tests live in the same commit as the code they cover.
- A significant decision gets an ADR in the same commit.

## Status legend

`[ ]` not started · `[~]` in progress · `[x]` committed

---

## Phase 0 · Foundation

| Done | # | Task | What you'll learn | Commit message |
|---|---|---|---|---|
| [x] | 1 | Repo baseline: `.gitignore`, execution plan, README skeleton (`assignment.txt` was already committed as the initial commit) | Repo hygiene, secrets never get committed | `chore: add repo baseline` |
| [x] | 2 | NestJS skeleton plus `GET /health` with **no database yet**, and Jest running (one test) | Project layout; why Nest 12 needs ESM-mode Jest and TypeScript pinned to 6 | `feat: scaffold NestJS app with health endpoint` |
| [x] | 3 | Validated config: fails at startup if env is wrong, plus `.env.example` | Fail-fast configuration | `feat: add validated configuration` |
| [x] | 4 | Global error handling: domain exceptions, one exception filter, validation pipe, request id, helmet | Why this comes before any feature; the single error envelope | `feat: add global exception handling` |
| [x] | 5 | Swagger at `/docs` | Documenting endpoints as we add them | `feat: add Swagger` |

## Phase 1 · Database connection

| Done | # | Task | What you'll learn | Commit message |
|---|---|---|---|---|
| [x] | 6 | `docker-compose.yml` with **only Postgres** and a healthcheck | Running infrastructure locally | `chore: add Postgres via docker compose` |
| [x] | 7 | TypeORM connection and migration runner (no tables yet); `/health` now checks the DB | Why `synchronize` is off and migrations own the schema | `feat: connect to PostgreSQL with migrations` |

## Phase 2 · Minimal registration (thin by design)

| Done | # | Task | What you'll learn | Commit message |
|---|---|---|---|---|
| [x] | 8 | `Company` and `User` entities, **migration 1**, repository ports and TypeORM adapters, architecture test, ADR 0001 | Ports and adapters; why use cases do not import TypeORM; database-enforced rules | `feat: add company and user persistence` |
| [x] | 9 | `POST /auth/register`: validated DTOs, company + admin created in one transaction, duplicate email returns 409, sample payload in Swagger | Validation vs. database constraint; transactions | `feat: add minimal registration` |
| [x] | 10 | JWT issued on register, JWT guard, `@CurrentUser`, `GET /onboarding/status` (companies start `PENDING_PAYMENT`) | JWT claims and guards; tenant scoping starts here | `feat: add JWT and onboarding status` |

## Phase 3 · Payment module (the deep part)

| Done | # | Task | What you'll learn | Commit message |
|---|---|---|---|---|
| [x] | 11 | `Money` value object: integer minor units, currency exponent table, exact parsing, ADR 0002 | Why floats and "always 2 decimals" are bugs waiting to happen | `feat: add money value object` |
| [x] | 12 | `Payment` as a **pure domain class** (no ORM decorators) with its state machine and a `version` field, unit-tested, no DB, no Nest | The core rule: illegal transitions can't corrupt state | `feat: add payment state machine` |
| [x] | 13 | **Migration 2**: `payments` (partial unique index, version column) and `webhook_events`; a separate **persistence model + mapper** for `Payment`, repositories with optimistic locking (ADR 0001, option B) | Database-enforced guarantees against double charging and lost updates | `feat: add payment persistence` |
| [x] | 14 | `PaymentProvider` **contract**, `MockPaymentProvider`, and a shared **contract test suite** (ADR: provider port) | Designing an integration boundary; testing adapters against one spec | `feat: add payment provider port and mock` |
| [x] | 15 | `StartPayment` use case: `POST /payments` and `GET /payments/:id`. Safe under concurrent clicks, handles a provider outage | Persist-intent-first; provider idempotency keys | `feat: start and resume payments` |
| [-] | 16 | ~~Client `Idempotency-Key` header~~ **Dropped:** `POST /payments` is already idempotent (one open payment per company, provider idempotency key, webhook inbox); the header would add a table and replay logic for a risk that is already impossible | n/a | n/a |
| [-] | 17 | ~~`POST /payments/:id/cancel`~~ **Dropped:** an abandoned checkout is simply resumed next time, and one open payment per company means nothing piles up; no requirement needs it | n/a | n/a |
| [x] | 18 | **Transactional outbox, part 1**: unit-of-work port, **migration 4** `outbox_messages`, status change + message in one transaction (ADR: outbox) | Dual-write problem and why outbox solves it | `feat: add transactional outbox` |
| [x] | 19 | **Outbox, part 2**: dispatcher with back-off and an attempt cap, idempotent activation consumer, timer. **First full backend flow works** (the mock simulator endpoints moved to task 20, where webhooks make them meaningful) | At-least-once delivery + idempotent consumers; one clock for scheduling decisions | `feat: activate company from outbox` |
| [x] | 20 | Webhook endpoint (`POST /webhooks/payments`, provider-neutral) with inbox table (duplicates, unknown payments, retries), event is a trigger not truth; plus the dev-only mock simulator endpoints (simulate a payment outcome, with or without its webhook; switch an outage on and off) | Signed webhooks; ordering and replay | `feat: handle provider webhooks` |
| [ ] | 21 | Reconciliation job for lost webhooks | The safety net for "paid but not activated" | `feat: add payment reconciliation` |
| [ ] | 22 | `StripePaymentProvider` adapter; contract suite runs against it when Stripe test keys are present; webhook signature tests | Mapping Stripe states and errors into ours | `feat: add Stripe adapter` |
| [ ] | 23 | Provider selection by config, public checkout config, Stripe-signed webhook e2e (raw body) | The raw-body pitfall | `feat: wire Stripe provider` |
| [ ] | 24 | Safe logging: payment id + request id on every line, PII/card-data redaction, tests | Logs are a data-leak surface | `feat: add safe payment logging` |

## Phase 4 · Frontend (minimal)

| Done | # | Task | Commit message |
|---|---|---|---|
| [ ] | 25 | Vite and React skeleton, typed API client, dev proxy | `feat(frontend): scaffold app` |
| [ ] | 26 | Register page with a **"Fill sample data"** helper and inline field errors | `feat(frontend): add register page` |
| [ ] | 27 | Payment step: Stripe Elements, plus mock panel when no keys | `feat(frontend): add payment step` |
| [ ] | 28 | Activation watcher (polling, slow/offline messages) and success screen | `feat(frontend): add activation status` |

## Phase 5 · Packaging and docs

| Done | # | Task | Commit message |
|---|---|---|---|
| [ ] | 29 | Dockerfiles, nginx, full `docker compose up` | `chore: containerize backend and frontend` |
| [ ] | 30 | Stripe CLI profile and a real test-mode walkthrough (needs Stripe keys) | `chore: add Stripe CLI profile` |
| [ ] | 31 | `DESIGN.md`, `PRESENTATION.md` (including the AI-usage slide the assignment requires), final README | `docs: add design and presentation` |

## Notes

**Lessons built in from the start** (learned in an earlier bulk build, kept as a reference outside the repo):

- TypeScript pinned to 6.0.3 (TypeScript 7 breaks `@nestjs/swagger` and `ts-jest`).
- Nest 12 packages are ESM-only, so Jest runs in native ESM mode.
- `@OnEvent` defaults to `suppressErrors: true`; it must be `false` or failed activations are silently swallowed. (With the outbox, activation retries are explicit instead of relying on webhook retries.)
- `FAILED` is not a final payment state: a declined card is retried on the same payment intent.
- Webhooks are only triggers; the handler re-reads the payment state from the provider.
- One open payment per company, enforced by a partial unique index.

**Known tradeoff of the thin registration.** There is no login, so the JWT in the browser is the only session. Closing the tab keeps it (localStorage, 24 h); losing it means registering again with new sample data. Acceptable because identity is not what is being evaluated.

**Environment.** Docker Desktop is installed (Docker 29.9, Compose 5.7), so every Docker-related task can be run and verified here. Database-backed tests use the Postgres from `docker-compose.yml` (start it with `docker compose up -d`), each test run creating its own throw-away database.

**Reference build.** The earlier full build (76 passing tests) lives outside the repo at `C:\Users\ngerg\Documents\Projects\payment-service-reference`. Its ideas are reintroduced piece by piece, not pasted in bulk.
