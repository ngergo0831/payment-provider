# ADR 0004: Concurrency safety lives in the database

- **Status:** accepted (task 13)
- **Context:** the same payment can be touched at the same moment by several actors: a customer double-clicking "Pay",
  a webhook, the reconciliation job, a "resume checkout" request. Application-level checks ("read, then decide, then write")
  are racy: two actors can both read "no open payment" and both proceed.

## Decision

Rules that must hold under concurrency are enforced by PostgreSQL itself, and the code only translates the database's
refusal into a domain-level error:

| Guarantee | Mechanism | Surfaces as |
|---|---|---|
| At most one open payment per company | partial unique index `uq_payments_one_open_per_company` (rows whose status is open) | `OpenPaymentAlreadyExistsError` |
| One provider payment belongs to at most one of ours | unique index `uq_payments_provider_ref` (NULLs allowed) | raw error: it would be a bug, not a race |
| No lost updates to a payment | optimistic locking: `UPDATE ... WHERE id = ? AND version = ?`, `version = version + 1` | `PaymentConcurrentModificationError` |
| Each provider event handled once | primary key on `webhook_events.provider_event_id` + `INSERT ... ON CONFLICT DO NOTHING` | the stored row, with `processedAt` |
| Data stays valid whatever the code does | CHECK constraints (status, positive amount, upper-case currency), foreign key to `companies` | raw error |

## Details worth knowing

- **Optimistic, not pessimistic.** Conflicts are rare and cheap to retry, so no row is locked while a request thinks.
  `save` returns the payment with its new version; callers continue with the returned object. A stale write changes nothing.
- **The domain does not own `version`.** The repository increments it; the pure `Payment` only carries it.
- **"Open" is defined once** in the domain (`OPEN_STATUSES`). The index predicate is built from it in the entity and written out
  in the migration; an end-to-end test inserts a payment in every status and proves the index agrees with the domain.
- **Amounts are `bigint`** (minor units can exceed 32 bits). The driver returns bigint as a string, so a transformer converts it,
  which is safe because `Money` guarantees a safe integer.
- **Timestamps come from the domain**, not database defaults, so the object and the row always agree.

## Consequences

- Every guarantee has a test that runs against a real PostgreSQL, including concurrent attempts (5 parallel inserts: exactly 1 wins).
  Each was mutation-checked by removing the mechanism and watching the test fail.
- Another database must offer equivalents (partial/conditional uniqueness, conditional update, insert-or-ignore) to pass the same tests (see ADR 0001).
