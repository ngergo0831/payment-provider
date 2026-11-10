# Design

Why the code is shaped the way it is. The README covers how to run and use it.

## Module layout and persistence

- **Ports in the application layer.** Use cases depend on abstract classes (`PaymentRepository`, `PaymentProvider`,
  `CompanyRepository`, ...), which are also the Nest DI tokens. Only `infrastructure/` implements them.
  An ESLint rule (`no-restricted-imports` in `backend/eslint.config.mjs`) enforces it: nothing under `application/` or
  `payments/domain/` imports the database or token libraries.
- **Two levels of strictness.** Onboarding's `Company` and `User` are thin, so they are decorated TypeORM entities. `Payment` holds
  the state machine, so it is a pure class with a separate persistence record and a mapper.
- **The schema is owned by migrations** (`synchronize` is off). Committed migrations are never edited; a change is a new migration.
- **Modules:** `auth` (JWT issuing and checking), `onboarding` (registration, companies, users), `payments` (everything about money),
  `health`. Payments reaches onboarding only through the `CompanyGateway` port, so there is no module cycle.

## Money

Every amount is a `Money` value object (`payments/domain/money.ts`):

- **Integer minor units only** (cents, yen), stored as `bigint`. This is also what Stripe expects.
- **An explicit table of supported currencies** and their decimal places. An unknown currency is rejected, not guessed.
- **Strict parsing, no rounding:** `"19.999"` USD is an error. Parsing is digit by digit, never through a float
  (`19.99 * 100` is `1998.9999999999998` in JavaScript; both that and a larger off-by-one case are pinned as tests).
- **Valid by construction:** a `Money` can never be fractional, negative or unsafe.

## The payment lifecycle

- **One state machine, the only way status changes.** `Payment.applyStatus()` checks every move against the transition table in
  `payment-status.ts`. Webhooks, reconciliation and "resume checkout" all go through it.
- **Outcomes, not exceptions:** `APPLIED`, `UNCHANGED` (a duplicate report) or `REJECTED` (stale or out-of-order information,
  which leaves the payment untouched). Providers send such reports routinely, so they are not errors.
- **`SUCCEEDED` and `CANCELED` are final**, so a late "failed" can never undo a success.
- **`FAILED` is not final.** A declined card can be retried on the same provider payment (Stripe's model). Treating a decline as final
  would leave the browser holding a secret for a payment we gave up on: a later success would be charged but never activated.
- **`PROCESSING` cannot be canceled:** the money may already be moving.
- A randomized test (5000 random report orders) checks that the first final status wins and that a rejected report changes nothing.

## Guarantees enforced by PostgreSQL

Read-then-write checks in the application are racy (a double click, a webhook and the reconciliation job can arrive together),
so these rules live in the database and the code only translates the refusal:

| Guarantee | Mechanism | Surfaces as |
|---|---|---|
| At most one live (not `CANCELED`) payment per company, so a paid company cannot start a second payment | partial unique index `uq_payments_one_live_per_company` | `LivePaymentAlreadyExistsError`; the loser resumes the winner's payment |
| One provider payment belongs to one of ours | unique index `uq_payments_provider_ref` | raw error (a bug, not a race) |
| No lost updates | optimistic locking on `version` | `PaymentConcurrentModificationError` |
| Valid data whatever the code does | CHECK constraints, foreign key to `companies` | raw error |

Every row in this table has a test against a real PostgreSQL, including parallel inserts.

## The payment provider port

`payments/application/ports/payment-provider.ts` documents the contract: idempotent creation, provider-neutral types, the provider
as the source of truth, authentic webhooks only, and three kinds of failure instead of raw SDK errors:

- unreachable, timed out or 5xx: `PaymentProviderUnavailableException` (HTTP 503, "nothing was charged, retry");
- request rejected: `PaymentProviderFailureException` (HTTP 502, our bug or misconfiguration);
- unknown reference: `ProviderPaymentNotFoundError`. `POST /payments` then closes the dead payment and starts a fresh one. This also
  covers a mock provider that lost its in-memory state on restart, and a payment made with a provider that is no longer configured.

One contract suite (`src/testing/payment-provider.contract.ts`) runs against both adapters. The mock can also simulate outages,
declines, 3-D Secure, slow banks and lost webhooks on demand; Stripe runs the parts it can (live test mode, opt-in).

Webhooks are only triggers: the handler re-reads the payment from the provider and applies it through the state machine, so
duplicates, late and out-of-order events cannot mislead it. Handling is idempotent, so no inbox table is needed; a redelivered
event is simply processed again and changes nothing.

When our record and the provider's disagree in a way no retry can fix (a different amount, a different provider payment), the
synchronizer raises `PaymentRecordConflictException`: logged as an error for a person, answered with 502, never retried in a loop.

## Activating the company: the transactional outbox

Saving "payment succeeded" and then activating the company would be a dual write: a crash between the two leaves a paid company that
is never activated, with no error anywhere. Instead:

1. `PaymentRepository.save(payment, messages)` updates the payment and inserts the `payment.succeeded` outbox row **in one transaction**.
   The message is queued only on the transition to `SUCCEEDED`, which happens once, so racing webhooks and reconciliation cannot queue two.
2. A timer (`OUTBOX_POLL_INTERVAL_MS`) delivers due rows. Delivery is at-least-once; activating an active company is a no-op.
3. Failures back off exponentially (5 s doubling, at most 5 minutes). A message is **never abandoned**, because that would strand a paid
   company: after 10 attempts it keeps retrying every 5 minutes and each failure is logged at `error` level, with the reason in
   `outbox_messages.last_error`. Once the cause is fixed, the next retry activates the company without a manual step.

A message broker was rejected (extra infrastructure, and its own dual write); in-process events are not atomic with the save.

## Reconciliation

Webhooks can be lost, so `ReconcilePaymentsUseCase` periodically re-reads payments that are not final, through the same code path as a
webhook. A payment is due when it has been quiet for `max(2 min, 10% of its age)`: a fresh checkout is checked every couple of minutes,
a week-old one about every 17 hours. Payments older than 30 days are left alone. `FAILED` payments are included (the customer may still
succeed with another card), and the backoff keeps them cheap. Syncing a payment whose status did not change records the check without
bumping its version, so the poll never competes with real updates.

## Background jobs

`PaymentBackgroundJobs` runs the outbox and reconciliation on `PeriodicTask`, a small wrapper around `setInterval` that skips a tick while
the previous run is still going and, on shutdown, waits for the run in progress before the database closes. `@nestjs/schedule` was
considered, but it offers neither, and its decorators cannot take intervals from configuration. A single instance is assumed: several would
be safe (every step is idempotent) but would duplicate work; `FOR UPDATE SKIP LOCKED` is the next step if that is ever needed.

## Security and configuration

- Configuration is validated at startup; the app lists every problem and exits. `NODE_ENV` and `PAYMENT_PROVIDER` have no defaults,
  so a deployment cannot silently run as development or on the mock provider.
- In production, the mock provider and the example `JWT_SECRET` are refused, Swagger is not mounted, and the `/dev/mock-payments`
  routes do not exist (they live in a module registered only with the mock provider).
- `POST /auth/register` and `POST /payments` are rate limited per client (`RATE_LIMIT_PER_MINUTE`, `429 TOO_MANY_REQUESTS`).
- JWTs carry only the user id (`sub`) and company id; every endpoint takes the company from the token, never from the request.
- Logging is Nest's `ConsoleLogger` (text or JSON) with a redaction step for secrets. An end-to-end canary test runs the main flows
  with all logging on and checks that no personal data, token or secret reaches stdout or stderr.
