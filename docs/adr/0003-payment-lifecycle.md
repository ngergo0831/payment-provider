# ADR 0003: The payment lifecycle

- **Status:** accepted (task 12)
- **Context:** payment providers report what happened asynchronously, and their messages can be duplicated, delayed, or
  arrive out of order. The company's activation depends on a payment's status, so the status must be trustworthy
  whatever order information arrives in.

## Decision

1. **One state machine, and it is the only way status changes.** `Payment.applyStatus()` checks every move against an
   explicit transition table (`payment-status.ts`). Webhooks, reconciliation and "resume checkout" all use it, so they
   cannot disagree about the rules.
2. **Three outcomes, never an exception:** `APPLIED`, `UNCHANGED` (a duplicate report), `REJECTED` (an illegal move,
   i.e. stale or out-of-order information). A rejected report leaves the payment untouched. It is expected input
   from a provider, so it is a result, not an error.
3. **`SUCCEEDED` and `CANCELED` are final.** Nothing leaves them, so a late "failed" can never undo a success.
4. **`FAILED` is NOT final.** A declined card does not end the payment: the customer may try another card on the same
   provider payment (Stripe's own model). A failed payment can return to `REQUIRES_ACTION`, `PROCESSING`, `SUCCEEDED`, or `CANCELED`.
5. **A payment in `PROCESSING` cannot be canceled.** The money may already be moving; it can only resolve to success or failure.
6. **A pure class.** `Payment` has no framework, ORM, clock or randomness except through arguments. It exposes a
   snapshot (`toSnapshot` / `restore`) for the persistence mapper (ADR 0001, option B).
7. **`version` belongs to persistence.** The domain never changes it; the repository uses it for optimistic locking.

## Why FAILED is not final

Treating a decline as final looks simpler ("failed means start over") but it breaks money in two ways:

- The customer's browser still holds the old payment's secret. If they succeed on it after we gave up, we have a paid
  provider payment that our records call failed: **charged, never activated**. Or we have opened a second payment for the
  same onboarding: **a double charge risk**.
- It needs a new provider payment per attempt, multiplying the things that can be out of sync.

With a retryable `FAILED`, there is one payment per onboarding attempt, and a late success on it is simply recorded.

## Consequences

- At most one **open** (non-final) payment per company. The database will enforce this with a partial unique index (task 13)
  using exactly `OPEN_STATUSES`.
- The spec is a visible matrix in `payment-status.spec.ts`; changing a rule means changing a line there on purpose.
- Guarantees are also checked by a randomized test (5000 random report orders): the first final status wins forever,
  a failure reason exists only while FAILED, and a rejected report changes nothing.

## Alternatives considered

- **FAILED as final, new payment per retry:** see above; rejected.
- **Trust the provider's event payload status directly:** ordering is not guaranteed, so a stale event could regress a paid
  payment. Later tasks go further: events only trigger a re-read of the provider's current state, and this machine is the second line of defence.
- **Throw on an illegal move:** would turn a normal, expected duplicate into a retry storm from the provider's webhook.
