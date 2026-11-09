import { randomUUID } from 'node:crypto';
import { Payment } from '../domain/payment';

/**
 * A message that must be delivered AFTER a payment change was saved (the "outbox" pattern).
 * It is stored in the same database transaction as the change, so the two can never get out of step:
 * either the payment is saved AND the message is queued, or neither is.
 */
export interface OutboxMessage {
  id: string;
  type: string;
  payload: unknown;
}

export const PAYMENT_SUCCEEDED = 'payment.succeeded';

export interface PaymentSucceededPayload {
  paymentId: string;
  companyId: string;
}

export function paymentSucceededMessage(payment: Payment): OutboxMessage {
  const payload: PaymentSucceededPayload = { paymentId: payment.id, companyId: payment.companyId };
  return { id: randomUUID(), type: PAYMENT_SUCCEEDED, payload };
}
