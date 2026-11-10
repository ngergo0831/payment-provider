import { Money } from '../../domain/money';
import { PaymentStatus } from '../../domain/payment-status';

/**
 * The integration contract: what every payment provider adapter (Stripe, the mock, a future one) must do. The contract test suite
 * (`src/testing/payment-provider.contract.ts`) checks each rule below against every adapter.
 *
 *  1. Idempotent creation. `createPayment` called twice with the same `paymentId` returns the same provider
 *     payment and never creates a second charge. This is what makes a retry after a timeout safe.
 *
 *  2. Provider-neutral types. Adapters return our `PaymentStatus` and `Money`. Provider-specific statuses,
 *     fields and exception classes never leave the adapter.
 *
 *  3. Three kinds of failure:
 *       - unreachable / timed out / 5xx / rate-limited  -> PaymentProviderUnavailableException  (retry later)
 *       - request rejected (bad key, invalid request)   -> PaymentProviderFailureException      (our bug)
 *       - `retrievePayment` for a reference it does not know -> ProviderPaymentNotFoundError
 *         (the mock lost its memory in a restart, or the keys now point at a different account)
 *
 *  4. The provider is the source of truth for a payment's state. `retrievePayment` always reads the current
 *     state, so webhook ordering and duplication can never mislead us (webhooks are only notifications).
 *
 *  5. Authentic webhooks only. `parseWebhook` verifies the signature over the exact raw bytes and throws
 *     InvalidWebhookSignatureException otherwise. Events we do not care about yield `null` (acknowledged, ignored).
 *
 *  6. `clientSecret` is what the browser needs to collect card details. It is null once the payment is final.
 */

export class ProviderPaymentNotFoundError extends Error {
  constructor(readonly providerRef: string) {
    super(`The provider has no payment ${providerRef}`);
    this.name = 'ProviderPaymentNotFoundError';
  }
}

export interface CreateProviderPaymentInput {
  paymentId: string;
  companyId: string;
  amount: Money;
}

export interface ProviderPayment {
  providerRef: string;
  status: PaymentStatus;
  amount: Money;
  clientSecret: string | null;
  failureCode: string | null;
}

export interface ProviderEvent {
  id: string;
  type: string;
  providerRef: string;
  paymentId: string | null;
}

export abstract class PaymentProvider {
  abstract readonly name: string;

  abstract readonly webhookSignatureHeader: string;

  /** @throws PaymentProviderUnavailableException | PaymentProviderFailureException */
  abstract createPayment(input: CreateProviderPaymentInput): Promise<ProviderPayment>;

  /** @throws PaymentProviderUnavailableException | PaymentProviderFailureException | ProviderPaymentNotFoundError */
  abstract retrievePayment(providerRef: string): Promise<ProviderPayment>;

  /** @throws InvalidWebhookSignatureException when the signature is missing or wrong. Returns null for irrelevant events. */
  abstract parseWebhook(rawBody: Buffer, signature: string | undefined): ProviderEvent | null;
}
