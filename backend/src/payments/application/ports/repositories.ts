import { Payment } from '../../domain/payment';
import { OutboxMessage } from '../outbox';

export class OpenPaymentAlreadyExistsError extends Error {
  constructor() {
    super('This company already has an open payment');
    this.name = 'OpenPaymentAlreadyExistsError';
  }
}

export class PaymentConcurrentModificationError extends Error {
  constructor(paymentId: string) {
    super(`Payment ${paymentId} was changed by someone else; reload it and try again`);
    this.name = 'PaymentConcurrentModificationError';
  }
}

export abstract class PaymentRepository {
  abstract findById(id: string): Promise<Payment | null>;

  abstract findByProviderRef(providerRef: string): Promise<Payment | null>;

  abstract findOpenByCompany(companyId: string): Promise<Payment | null>;

  /**
   * Open payments that are linked to the provider, were created after `createdAfter`, and have not been compared with
   * the provider since `notSyncedSince` (a payment never synced counts from its creation). Least recently synced first.
   */
  abstract findDueForReconciliation(query: { notSyncedSince: Date; createdAfter: Date; limit: number }): Promise<Payment[]>;

  /**
   * Stores a NEW payment.
   * @throws OpenPaymentAlreadyExistsError if the company already has an open payment, including when two requests race.
   */
  abstract insert(payment: Payment): Promise<void>;

  /**
   * Stores changes to an EXISTING payment, and returns it as persisted: the same data with the new `version`.
   * Always continue with the RETURNED payment; the one passed in still carries the old version.
   *
   * `messages` are queued in the SAME transaction as the change (the outbox pattern): the payment is saved and the
   * messages are queued, or nothing happens at all. This is what stops a paid payment from being forgotten.
   *
   * @throws PaymentConcurrentModificationError if the stored version is no longer the one this payment was loaded
   *         with. Nothing is written in that case, not even the messages (no lost updates).
   */
  abstract save(payment: Payment, messages?: OutboxMessage[]): Promise<Payment>;
}

export interface QueuedMessage extends OutboxMessage {
  attempts: number;
}

export abstract class OutboxRepository {
  abstract findDue(now: Date, maxAttempts: number, limit: number): Promise<QueuedMessage[]>;

  abstract markDelivered(messageId: string, now: Date): Promise<void>;

  abstract markFailed(messageId: string, reason: string, retryAt: Date): Promise<void>;
}

export interface InboundEvent {
  id: string;
  type: string;
  payload: unknown;
}

export interface InboxEntry {
  /**
   * True only once the event was FULLY handled. A stored-but-unfinished event (we crashed, the provider was down)
   * reports false, so the provider's retry is processed again instead of being skipped as a duplicate.
   */
  alreadyProcessed: boolean;
}

export abstract class WebhookEventRepository {
  /** Stores the event if it has not been seen, and reports whether it was already handled. Safe under concurrent duplicates. */
  abstract recordIfNew(event: InboundEvent): Promise<InboxEntry>;

  abstract markProcessed(eventId: string): Promise<void>;
}
