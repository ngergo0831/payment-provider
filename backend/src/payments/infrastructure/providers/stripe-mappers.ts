import type Stripe from 'stripe';
import { ProviderPayment } from '../../application/ports/payment-provider';
import { Money } from '../../domain/money';
import { isFinal, PaymentStatus } from '../../domain/payment-status';

/** Stripe's PaymentIntent status -> our provider-neutral status. Pure, so it is easy to test exhaustively. */
export function mapIntentStatus(intent: Pick<Stripe.PaymentIntent, 'status' | 'last_payment_error'>): PaymentStatus {
  switch (intent.status) {
    case 'succeeded':
      return PaymentStatus.SUCCEEDED;
    case 'processing':
    case 'requires_capture': // we capture automatically, so this is "in flight" for us
      return PaymentStatus.PROCESSING;
    case 'requires_action':
      return PaymentStatus.REQUIRES_ACTION;
    case 'canceled':
      return PaymentStatus.CANCELED;
    case 'requires_payment_method':
      // A brand-new intent also waits here. Only a recorded error means an attempt actually FAILED.
      return intent.last_payment_error ? PaymentStatus.FAILED : PaymentStatus.CREATED;
    default:
      return PaymentStatus.CREATED; // requires_confirmation: details given, not confirmed yet
  }
}

export function toProviderPayment(intent: Stripe.PaymentIntent): ProviderPayment {
  const status = mapIntentStatus(intent);
  const error = intent.last_payment_error;
  return {
    providerRef: intent.id,
    status,
    // Stripe's `amount` is in minor units and `currency` is lower-case: exactly what Money.of expects.
    amount: Money.of(intent.amount, intent.currency),
    // Nothing left to collect once final, so the secret is withheld (contract rule 6).
    clientSecret: isFinal(status) ? null : intent.client_secret,
    failureCode: status === PaymentStatus.FAILED ? (error?.decline_code ?? error?.code ?? 'payment_failed') : null,
  };
}

/** The only Stripe event types we react to: each means "something about this PaymentIntent changed". */
export const HANDLED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.processing',
  'payment_intent.requires_action',
  'payment_intent.canceled',
]);
