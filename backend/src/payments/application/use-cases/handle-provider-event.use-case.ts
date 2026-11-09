import { Injectable, Logger } from '@nestjs/common';
import { Payment } from '../../domain/payment';
import { PaymentSynchronizer } from '../payment-synchronizer';
import { PaymentProvider, ProviderEvent } from '../ports/payment-provider';
import { PaymentRepository, WebhookEventRepository } from '../ports/repositories';

export enum EventHandlingResult {
  PROCESSED = 'PROCESSED',
  /** This exact event was already handled completely: nothing to do. */
  DUPLICATE = 'DUPLICATE',
  /** Not about a payment of ours (e.g. another product sharing the same provider account). */
  UNKNOWN_PAYMENT = 'UNKNOWN_PAYMENT',
}

/**
 * Handles one AUTHENTICATED notification from the provider.
 *
 * The event is only a TRIGGER: its content is not trusted. We ask the provider for the payment's current state and
 * apply that, so a late, duplicated or out-of-order notification cannot mislead us (ADR 0003, 0005).
 *
 * Reliable without distributed transactions:
 *  - the event id goes into the inbox first; a fully handled duplicate is skipped
 *  - the event is marked processed only AFTER everything succeeded, so if we crash or the provider is down, the
 *    provider's retry is handled again instead of being mistaken for a duplicate
 *  - every step is idempotent, so handling the same event twice is harmless
 */
@Injectable()
export class HandleProviderEventUseCase {
  private readonly logger = new Logger(HandleProviderEventUseCase.name);

  constructor(
    private readonly provider: PaymentProvider,
    private readonly payments: PaymentRepository,
    private readonly inbox: WebhookEventRepository,
    private readonly synchronizer: PaymentSynchronizer,
  ) {}

  async execute(event: ProviderEvent): Promise<EventHandlingResult> {
    const stored = await this.inbox.recordIfNew({ id: event.id, type: event.type, payload: event.raw });
    if (stored.processedAt) return EventHandlingResult.DUPLICATE;

    const payment = await this.locate(event);
    if (!payment) {
      // Acknowledge, so the provider stops retrying something that can never match.
      this.logger.warn(`Event ${event.id} is about an unknown payment (${event.providerRef}); ignoring`);
      await this.inbox.markProcessed(event.id);
      return EventHandlingResult.UNKNOWN_PAYMENT;
    }

    const remote = await this.provider.retrievePayment(event.providerRef);
    await this.synchronizer.apply(payment.id, remote);
    await this.inbox.markProcessed(event.id);
    return EventHandlingResult.PROCESSED;
  }

  private async locate(event: ProviderEvent): Promise<Payment | null> {
    const byReference = await this.payments.findByProviderRef(event.providerRef);
    if (byReference) return byReference;

    // We may have crashed between "the provider created the payment" and "we stored its reference". The provider echoes
    // our payment id, so the link can be repaired: but ONLY for a payment that has no reference yet (never re-link).
    if (!event.paymentId) return null;
    const byId = await this.payments.findById(event.paymentId);
    return byId && byId.providerRef === null ? byId : null;
  }
}
