# ADR 0005: The payment provider port and its contract

- **Status:** accepted (task 14)
- **Context:** the payment provider (Stripe) is the least stable, least controllable part of the system: it has outages, its
  SDK and statuses change, and we cannot cause its failures on demand to test against. We also want the system to run and be
  demoed without a Stripe account.

## Decision

1. **A port with a written contract** (`payments/application/ports/payment-provider.ts`). It has three operations
   (`createPayment`, `retrievePayment`, `parseWebhook`) and six rules every adapter must honour:
   idempotent creation, provider-neutral types, two kinds of failure, the provider as source of truth, authentic webhooks
   only, and a client secret that disappears when the payment is final.
2. **Two kinds of failure, never raw SDK errors.** *Unreachable / timed out / 5xx* becomes `PaymentProviderUnavailableException`
   (HTTP 503, "retry shortly, nothing was charged"). *Request rejected* becomes `PaymentProviderFailureException`
   (HTTP 502, our bug or misconfiguration: retrying will not help). The exception filter's mapping is exhaustive, so a
   new failure kind cannot be forgotten.
3. **The provider is the source of truth.** `retrievePayment` reads current state; webhooks are only triggers to look. Ordering and
   duplication of notifications therefore cannot mislead us (ADR 0003 is the second line of defence).
4. **A first-class mock adapter** that obeys the same contract and can reproduce failures on demand: outage, decline, 3-D Secure,
   "slow bank", and a payment that succeeded with no webhook ever sent.
5. **One contract test suite** (`src/testing/payment-provider.contract.ts`) run against every adapter. Capabilities a provider
   cannot simulate (a real Stripe cannot be switched off) are optional hooks: the tests that need them are *skipped*, not faked.
6. **The amount travels back.** `ProviderPayment.amount` lets callers verify the provider will charge exactly what we asked.

## Consequences

- "Swap Stripe for another provider" is a proven claim: write an adapter, run the contract suite.
- The suite was checked by breaking each rule in the mock (non-idempotent create, wrong error type, secret kept after final,
  retrieval ignoring outages, unsigned webhooks accepted, wrong amount, a succeeded payment that can change): every
  breakage fails the suite.
- The mock keeps its state in memory and loses it on restart; it is for development and tests only.

## Alternatives considered

- **Depend on the Stripe SDK directly:** least code, but every use case would import Stripe types, outages could not be tested,
  and the system could not run without an account.
- **Mock only inside tests:** loses the ability to demo failure scenarios to a reviewer, and the mock would not be held to the contract.
