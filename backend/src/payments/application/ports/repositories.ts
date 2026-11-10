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
  abstract findLiveByCompany(companyId: string): Promise<Payment | null>;
  abstract findDueForReconciliation(query: ReconciliationQuery): Promise<Payment[]>;
  abstract insert(payment: Payment): Promise<void>;
  abstract save(payment: Payment, messages?: OutboxMessage[]): Promise<Payment>;
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
