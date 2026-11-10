import { Payment } from '../../domain/payment';
import { OutboxMessage } from '../outbox';

export class LivePaymentAlreadyExistsError extends Error {
  constructor() {
    super('This company already has an open or succeeded payment');
    this.name = 'LivePaymentAlreadyExistsError';
  }
}

export class PaymentConcurrentModificationError extends Error {
  constructor(paymentId: string) {
    super(`Payment ${paymentId} was changed by someone else; reload it and try again`);
    this.name = 'PaymentConcurrentModificationError';
  }
}

/**
 * Open, linked payments of `provider`, created after `createdAfter`, that have not been synced for
 * max(minQuietMs, quietFractionOfAge * their age) at `now`: the older a payment, the less often it is checked.
 */
export interface ReconciliationQuery {
  provider: string;
  now: Date;
  minQuietMs: number;
  quietFractionOfAge: number;
  createdAfter: Date;
  limit: number;
}

export abstract class PaymentRepository {
  abstract findById(id: string): Promise<Payment | null>;

  abstract findByProviderRef(providerRef: string): Promise<Payment | null>;

  /** The company's payment in progress, or the one that succeeded. There is at most one (see LIVE_STATUSES). */
  abstract findLiveByCompany(companyId: string): Promise<Payment | null>;

  /**
   * Open payments of `provider` that are linked to it, were created after `createdAfter`, and have not been compared
   * with it since `notSyncedSince` (a payment never synced counts from its creation). Least recently synced first.
   */
  abstract findDueForReconciliation(query: ReconciliationQuery): Promise<Payment[]>;

  /**
   * Stores a NEW payment.
   * @throws LivePaymentAlreadyExistsError if the company already has an open or succeeded payment, including when two
   *         requests race.
   */
  abstract insert(payment: Payment): Promise<void>;

  /**
   * Stores changes to an EXISTING payment, and returns it as persisted: the same data with the new `version`.
   * Always continue with the RETURNED payment; the one passed in still carries the old version.
   *
   * `messages` are queued in the same transaction as the change (the outbox pattern): the payment is saved and the
   * messages are queued, or nothing happens at all. This is what stops a paid payment from being forgotten.
   *
   * @throws PaymentConcurrentModificationError if the stored version is no longer the one this payment was loaded
   *         with. Nothing is written in that case, not even the messages (no lost updates).
   */
  abstract save(payment: Payment, messages?: OutboxMessage[]): Promise<Payment>;

  /**
   * Records that the payment was compared with the provider and nothing had changed. Does not bump the version, so a
   * routine check never makes a concurrent real update lose its optimistic lock.
   */
  abstract recordSynced(paymentId: string, at: Date): Promise<void>;
}

export interface QueuedMessage extends OutboxMessage {
  attempts: number;
}

export abstract class OutboxRepository {
  abstract findDue(now: Date, limit: number): Promise<QueuedMessage[]>;

  abstract markDelivered(messageId: string, now: Date): Promise<void>;

  abstract markFailed(messageId: string, reason: string, retryAt: Date): Promise<void>;
}
