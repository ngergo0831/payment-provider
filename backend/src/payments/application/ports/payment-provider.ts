import { Money } from '../../domain/money';
import { PaymentStatus } from '../../domain/payment-status';
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
