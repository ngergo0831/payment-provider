import { Money } from '../../domain/money';
import { PaymentStatus } from '../../domain/payment-status';

/**
 * ============================  THE INTEGRATION CONTRACT  ============================
 * What every payment provider adapter (Stripe, the mock, a future one) MUST do. The contract test suite
 * (`src/testing/payment-provider.contract.ts`) checks each rule below against every adapter.
 *
 *  1. IDEMPOTENT CREATION. `createPayment` called twice with the same `paymentId` returns the SAME provider
 *     payment and never creates a second charge. This is what makes a retry after a timeout safe.
 *
 *  2. PROVIDER-NEUTRAL TYPES. Adapters return our `PaymentStatus` and `Money`. Provider-specific statuses,
 *     fields and exception classes never leave the adapter.
 *
 *  3. TWO KINDS OF FAILURE, mapped to our exceptions:
 *       - unreachable / timed out / 5xx / rate-limited  -> PaymentProviderUnavailableException  (retry later)
 *       - request rejected (bad key, invalid request)   -> PaymentProviderFailureException      (our bug)
 *
 *  4. THE PROVIDER IS THE SOURCE OF TRUTH for a payment's state. `retrievePayment` always reads the current
 *     state, so webhook ordering and duplication can never mislead us (webhooks are only notifications).
 *
 *  5. AUTHENTIC WEBHOOKS ONLY. `parseWebhook` verifies the signature over the exact raw bytes and throws
 *     InvalidWebhookSignatureException otherwise. Events we do not care about yield `null` (acknowledged, ignored).
 *
 *  6. `clientSecret` is what the browser needs to collect card details. It is null once the payment is final.
 * ====================================================================================
 */

export interface CreateProviderPaymentInput {
  /** OUR payment id. It is the idempotency key: the same id always maps to the same provider payment. */
  paymentId: string;
  companyId: string;
  amount: Money;
}

/** A snapshot of the provider's record of one payment. */
export interface ProviderPayment {
  /** The provider's own id for it (e.g. a Stripe PaymentIntent id). */
  providerRef: string;
  status: PaymentStatus;
  /** What the provider says it will charge. Callers verify it equals what WE asked for. */
  amount: Money;
  /** For the browser SDK. Null once the payment is final (nothing left to collect). */
  clientSecret: string | null;
  /** Provider-neutral reason of the last failed attempt (e.g. `card_declined`), if any. */
  failureCode: string | null;
}

/** An authenticated notification from the provider. A TRIGGER to look at a payment, not the truth about it. */
export interface ProviderEvent {
  /** The provider's unique event id, used for de-duplication. */
  id: string;
  type: string;
  /** The provider's id of the payment the event is about. */
  providerRef: string;
  /** OUR payment id, if the provider echoed our metadata back: a fallback way to find the payment. */
  paymentId: string | null;
  /** The original event, stored in the inbox for audit. */
  raw: unknown;
}

export abstract class PaymentProvider {
  /** Short, stable name stored with each payment, e.g. "stripe" or "mock". */
  abstract readonly name: string;

  /** Which HTTP header carries the webhook signature (lower-case), e.g. "stripe-signature". The controller stays provider-neutral. */
  abstract readonly webhookSignatureHeader: string;

  /** @throws PaymentProviderUnavailableException | PaymentProviderFailureException */
  abstract createPayment(input: CreateProviderPaymentInput): Promise<ProviderPayment>;

  /** @throws PaymentProviderUnavailableException | PaymentProviderFailureException (also for an unknown reference) */
  abstract retrievePayment(providerRef: string): Promise<ProviderPayment>;

  /** @throws InvalidWebhookSignatureException when the signature is missing or wrong. Returns null for irrelevant events. */
  abstract parseWebhook(rawBody: Buffer, signature: string | undefined): ProviderEvent | null;
}
