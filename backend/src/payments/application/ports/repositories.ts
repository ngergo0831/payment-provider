import { Payment } from '../../domain/payment';

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
   * Stores a NEW payment.
   * @throws OpenPaymentAlreadyExistsError if the company already has an open payment, including when two requests race.
   */
  abstract insert(payment: Payment): Promise<void>;

  /**
   * Stores changes to an EXISTING payment, and returns it as persisted: the same data with the new `version`.
   * Always continue with the RETURNED payment; the one passed in still carries the old version.
   *
   * @throws PaymentConcurrentModificationError if the stored version is no longer the one this payment was loaded
   *         with. Nothing is written in that case (no lost updates).
   */
  abstract save(payment: Payment): Promise<Payment>;
}

/** A provider notification as stored in the inbox. */
export interface InboundEvent {
  /** The provider's own event id: unique, used for de-duplication. */
  id: string;
  type: string;
  payload: unknown;
}

export interface StoredInboundEvent {
  id: string;
  type: string;
  receivedAt: Date;
  /** Null until fully handled: a stored-but-unprocessed event must be processed again when the provider retries. */
  processedAt: Date | null;
}

export abstract class WebhookEventRepository {
  /**
   * Stores the event if it has not been seen, and returns the stored row either way. The caller can then tell
   * "already fully processed" (skip) from "seen but never finished" (process again). Safe under concurrent duplicates.
   */
  abstract recordIfNew(event: InboundEvent): Promise<StoredInboundEvent>;

  abstract markProcessed(eventId: string): Promise<void>;
}
