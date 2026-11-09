# ADR 0006: Transactional outbox for "payment succeeded"

- **Status:** accepted (tasks 18-19)
- **Context:** when a payment succeeds, the company must be activated. These are two different pieces of data owned by two
  modules. Saving the payment and then calling onboarding is a **dual write**: a crash, a deploy or a database error between
  the two steps leaves a paid payment that nobody acts on, with no error anywhere. That is the worst failure this product has.

## Decision

1. **The message is written in the same database transaction as the status change.** `PaymentRepository.save(payment, messages)`
   updates the payment (with its optimistic-lock check) and inserts the outbox rows in one transaction: both happen or neither does.
2. **Exactly one message per success.** The synchronizer queues `payment.succeeded` only at the moment of the *transition* to
   SUCCEEDED. A payment can reach that final state once, so duplicate webhooks, reconciliation passes and racing requests cannot
   produce a second message. A save that loses the optimistic-lock race queues nothing.
3. **Delivery is a separate step** (task 19): a dispatcher reads undelivered rows and hands them to a handler. Delivery is
   at-least-once, so handlers must be idempotent. Activating an already-active company is a no-op.
4. **Failures are retried with a simple back-off**, recorded on the row (`attempts`, `last_error`, `available_at`), and given up
   after a fixed number of attempts, leaving the row visible for a person.

## Why not the alternatives

- **In-process events** (what a first version used): not atomic with the save, and a failing listener is easy to swallow silently.
- **A message broker:** extra infrastructure and its own dual-write problem (database + broker). The outbox needs only the database we already have.
- **Two-phase commit:** not available across a database and an in-process call, and far heavier than needed.

## Consequences

- One small table (`outbox_messages`) and one optional argument on `save`; no framework.
- A single dispatcher instance is assumed. Running several would be safe (idempotent handlers) but wasteful; row locking
  (`FOR UPDATE SKIP LOCKED`) is the documented next step if that is ever needed.
- Atomicity is verified against the real database: a message is queued with the change, nothing is queued when the save loses a
  race, and a failure while writing the message undoes the payment change.
