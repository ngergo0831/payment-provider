import { Payment } from '../../domain/payment';
import { OutboxMessage } from '../outbox';

/** The company already has an open (non-final) payment. Expected under concurrent requests; callers re-read and reuse it. */
export class OpenPaymentAlreadyExistsError extends Error {
  constructor() {
    super('This company already has an open payment');
    this.name = 'OpenPaymentAlreadyExistsError';
  }
}

/**
 * Someone else changed the payment between our read and our write (optimistic locking).
 * Nothing was saved. The caller should re-read the payment and decide again.
 */
export class PaymentConcurrentModificationError extends Error {
  constructor(paymentId: string) {
    super(`Payment ${paymentId} was changed by someone else; reload it and try again`);
    this.name = 'PaymentConcurrentModificationError';
  }
}

/** PORT: persistence of payments, stated without database vocabulary. */
export abstract class PaymentRepository {
  abstract findById(id: string): Promise<Payment | null>;

  /** The provider's own reference (e.g. a Stripe PaymentIntent id). */
  abstract findByProviderRef(providerRef: string): Promise<Payment | null>;

  /** The company's single non-final payment, if it has one. */
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

/** A queued outbox message waiting to be delivered. */
export interface QueuedMessage extends OutboxMessage {
  /** How many delivery attempts have already failed. */
  attempts: number;
}

/** PORT: the delivery side of the outbox (the writing side is `PaymentRepository.save`). */
export abstract class OutboxRepository {
  /** Undelivered messages that are due now and have not used up their attempts, oldest first. */
  abstract findDue(now: Date, maxAttempts: number, limit: number): Promise<QueuedMessage[]>;

  abstract markDelivered(messageId: string, now: Date): Promise<void>;

  /** Counts the failed attempt, keeps the reason for a human, and postpones the next attempt. */
  abstract markFailed(messageId: string, reason: string, retryAt: Date): Promise<void>;
}

/** A provider notification as stored in the inbox. */
export interface InboundEvent {
  /** The provider's own event id: unique, used for de-duplication. */
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
