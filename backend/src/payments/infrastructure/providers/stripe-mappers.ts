import type Stripe from 'stripe';
import { ProviderPayment } from '../../application/ports/payment-provider';
import { Money } from '../../domain/money';
import { isFinal, PaymentStatus } from '../../domain/payment-status';

export function mapIntentStatus(intent: Pick<Stripe.PaymentIntent, 'status' | 'last_payment_error'>): PaymentStatus {
  switch (intent.status) {
    case 'succeeded':
      return PaymentStatus.SUCCEEDED;
    case 'processing':
    case 'requires_capture':      return PaymentStatus.PROCESSING;
    case 'requires_action':
      return PaymentStatus.REQUIRES_ACTION;
    case 'canceled':
      return PaymentStatus.CANCELED;
    case 'requires_payment_method':
      return intent.last_payment_error ? PaymentStatus.FAILED : PaymentStatus.CREATED;
    default:
      return PaymentStatus.CREATED;
  }
}

export function toProviderPayment(intent: Stripe.PaymentIntent): ProviderPayment {
  const status = mapIntentStatus(intent);
  const error = intent.last_payment_error;
  return {
    providerRef: intent.id,
    status,
    amount: Money.of(intent.amount, intent.currency),
    clientSecret: isFinal(status) ? null : intent.client_secret,
    failureCode: status === PaymentStatus.FAILED ? (error?.decline_code ?? error?.code ?? 'payment_failed') : null,
  };
}

export const HANDLED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.processing',
  'payment_intent.requires_action',
  'payment_intent.canceled',
]);
