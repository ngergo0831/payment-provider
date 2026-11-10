import { Injectable, Logger } from '@nestjs/common';
import { Payment } from '../../domain/payment';
import { PaymentRecordConflictException } from '../payment-record-conflict.exception';
import { PaymentSynchronizer } from '../payment-synchronizer';
import { PaymentProvider, ProviderEvent, ProviderPayment, ProviderPaymentNotFoundError } from '../ports/payment-provider';
import { PaymentRepository } from '../ports/repositories';

export enum EventHandlingResult {
  PROCESSED = 'PROCESSED',
  UNKNOWN_PAYMENT = 'UNKNOWN_PAYMENT',
  /** Our record and the provider's disagree (e.g. a different amount); left for manual review. */
  CONFLICT = 'CONFLICT',
}

/**
 * Handles one authenticated notification from the provider.
 *
 * The event is only a trigger: its content is not trusted. We ask the provider for the payment's current state and
 * apply that, so a late, duplicated or out-of-order notification cannot mislead us, and handling one twice is harmless.
 * Any failure propagates, so the provider retries the delivery.
 */
@Injectable()
export class HandleProviderEventUseCase {
  private readonly logger = new Logger(HandleProviderEventUseCase.name);

  constructor(
    private readonly provider: PaymentProvider,
    private readonly payments: PaymentRepository,
    private readonly synchronizer: PaymentSynchronizer,
  ) {}

  async execute(event: ProviderEvent): Promise<EventHandlingResult> {
    this.logger.log(`Webhook event ${event.id} (${event.type}) for ${event.providerRef}`);

    const payment = await this.locate(event);
    const remote = payment && (await this.retrieve(event.providerRef));
    if (!payment || !remote) {
      this.logger.warn(`Event ${event.id} is about an unknown payment (${event.providerRef}); ignoring`);
      return EventHandlingResult.UNKNOWN_PAYMENT;
    }

    try {
      await this.synchronizer.apply(payment.id, remote);
    } catch (error) {
      if (!(error instanceof PaymentRecordConflictException)) throw error;
      return EventHandlingResult.CONFLICT;
    }
    return EventHandlingResult.PROCESSED;
  }

  private async retrieve(providerRef: string): Promise<ProviderPayment | null> {
    try {
      return await this.provider.retrievePayment(providerRef);
    } catch (error) {
      if (error instanceof ProviderPaymentNotFoundError) return null;
      throw error;
    }
  }

  private async locate(event: ProviderEvent): Promise<Payment | null> {
    const payment = await this.findPayment(event);
    return payment?.provider === this.provider.name ? payment : null;
  }

  private async findPayment(event: ProviderEvent): Promise<Payment | null> {
    const byReference = await this.payments.findByProviderRef(event.providerRef);
    if (byReference) return byReference;

    if (!event.paymentId) return null;
    const byId = await this.payments.findById(event.paymentId);
    return byId && byId.providerRef === null ? byId : null;
  }
}
