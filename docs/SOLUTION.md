# Solution

> As a company admin, I need to sign up, register my business, and pay for my plan so that my account is activated immediately on success and recovers safely from payment failures or delayed confirmations.

Registration collects the admin and the company. The depth is one integration: Stripe PaymentIntents, with a mock provider behind the same contract. How to run it is in the [README](../README.md); the reasoning behind individual choices is in [DESIGN.md](DESIGN.md).

## Architecture

One NestJS service, four modules: `auth` (a JWT with only the user and company id), `onboarding` (company and admin in one transaction, `PENDING_PAYMENT` to `ACTIVE`), `payments` (the `Payment` aggregate, its state machine, the provider, webhooks, reconciliation, and the outbox), and `health`. Use cases depend on ports; only infrastructure talks to PostgreSQL or Stripe. Payments reaches onboarding only through a `CompanyGateway`.

Confirmation is asynchronous and webhooks arrive duplicated or out of order, so one state machine is the only way a status changes. The races, one live payment per company and no lost updates, are enforced in PostgreSQL, and one service keeps the payment update and the activation message in the same transaction.

## Integration boundaries

`PaymentProvider` is the contract for Stripe and the mock. `createPayment` is idempotent per payment id (Stripe key `payment-create-<id>`), `retrievePayment` returns the provider's record, and `parseWebhook` checks the signature over the raw body. Failures are three types: unavailable (`503`, nothing charged), rejected (`502`), and an unknown reference, which closes the payment and starts a fresh one. The adapter times out at 10 seconds and retries twice. Production refuses the mock, and its dev routes simulate a decline, 3-D Secure, a slow bank, a lost webhook, and an outage.

A webhook only triggers a re-read, so a duplicate, late, or forged event cannot change the outcome. The payment update and a `payment.succeeded` outbox row commit together; a one-second poll delivers it at least once, and activation is idempotent. The company always comes from the token, and clients branch on a single error `code`.

## Failure scenarios and recovery

Invalid registration is `422` with every field listed, and nothing is written; the form keeps the input. A duplicate email is `409`, a bad token is `401` and ends the session, and a decline is `FAILED` but retryable, with the user told that nothing was charged. If Stripe is down the start returns `503` and the retry resumes the same payment, so the idempotency key blocks a second charge. A lost webhook is covered by Stripe's retries and by a job that re-reads open payments; the user can also press "Check again now". If activation fails after a charge, the outbox retries with backoff and is never dropped. A reload follows the backend's real state, and while the service is unreachable the screen says the payment is safe and continues on its own. Two tabs cannot open two payments, `SUCCEEDED` and `CANCELED` are final, and a mismatch no retry can fix is logged for a person.

## Tradeoffs

Activation waits for the provider, so a closed tab cannot create a free account, at the cost of a few seconds of "Activating…". Re-reading each webhook costs one call and means the payload is never trusted. An in-process outbox beat a broker, which adds infrastructure and its own dual write. `FAILED` stays retryable, so a later success on the same PaymentIntent still activates the account. Polling, no login, and one job instance kept the slice small; every step is idempotent, so more instances would be safe but would repeat work.

For stakeholders this is an outcome: a customer is never charged twice, and a customer who paid is activated within a second, or a few minutes if the webhook is lost. Amount mismatches are logged for a person and need an alert and a runbook before real traffic.

## Scope

Built: registration, the payment lifecycle on Stripe and the mock, the state machine, database invariants, the outbox, reconciliation, redacted logs, and a frontend for decline, delay, and downtime. Left for later modules: login, extra users, business verification, subscriptions, tax and invoices, refunds, a broker, and an admin screen. Payment was the integration because its failure surface is what decides whether a customer who paid actually gets in, and these cuts leave that surface small enough to finish and to test.

## AI usage

I treated Claude as a working partner from the first reading of the brief. I shared the relevant part and asked it to question me, so my answers would show whether I had understood the problem. I then described the solution I had in mind and asked it to check that proposal against the brief.

With the architecture and the stack I decided, Claude drafted a full plan. I corrected it, and we implemented in the smallest steps I would take on a real task, so each review stayed small. When I considered the work finished I reread every file, wrote down what I would change and what I still questioned, and we went through another round. After the functional tests, the documentation followed the same pattern: I set out the ideas, Claude drafted them, and I reviewed them into this version.
