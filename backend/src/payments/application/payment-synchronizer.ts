import { Injectable, Logger } from '@nestjs/common';
import { PaymentNotFoundException } from '../../common/errors/exceptions';
import { Payment, TransitionOutcome } from '../domain/payment';
import { PaymentStatus } from '../domain/payment-status';
import { paymentSucceededMessage } from './outbox';
import { PaymentRecordConflictException } from './payment-record-conflict.exception';
import { ProviderPayment } from './ports/payment-provider';
import { PaymentConcurrentModificationError, PaymentRepository } from './ports/repositories';

const MAX_SAVE_ATTEMPTS = 3;

interface Change {
  outcome: TransitionOutcome;
  newlyLinked: boolean;
}

@Injectable()
export class PaymentSynchronizer {
  private readonly logger = new Logger(PaymentSynchronizer.name);

  constructor(private readonly payments: PaymentRepository) {}

  /**
   * Applies the provider's current record to our payment and returns the saved result. Safe to run concurrently for
   * the same payment: applying a snapshot is idempotent, so after losing the optimistic lock it is simply applied again.
   */
  apply(paymentId: string, remote: ProviderPayment, now: Date = new Date()): Promise<Payment> {
    return this.update(paymentId, now, (payment) => {
      if (!remote.amount.equals(payment.amount)) {
        throw this.conflict(paymentId, `we asked for ${payment.amount.toString()}, the provider reports ${remote.amount.toString()}`);
      }
      if (payment.providerRef !== null && payment.providerRef !== remote.providerRef) {
        throw this.conflict(paymentId, `already linked to ${payment.providerRef}, the provider reports ${remote.providerRef}`);
      }
      const newlyLinked = payment.providerRef !== remote.providerRef;
      payment.attachProviderRef(remote.providerRef, now);
      const outcome = payment.applyStatus(remote.status, remote.failureCode, now);
      if (outcome === TransitionOutcome.REJECTED) {
        this.logger.warn(`Ignored stale report for payment ${paymentId}: ${payment.status} -> ${remote.status}`);
      }
      return { outcome, newlyLinked };
    });
  }

  /**
   * Closes a payment the provider has no record of: it can never be paid, so the company needs a fresh one.
   * A payment that may have money in flight (PROCESSING) is not closed blindly; that needs a person.
   */
  retire(paymentId: string, now: Date = new Date()): Promise<Payment> {
    return this.update(paymentId, now, (payment) => {
      const outcome = payment.applyStatus(PaymentStatus.CANCELED, null, now);
      if (outcome === TransitionOutcome.REJECTED) {
        throw this.conflict(paymentId, `it is ${payment.status} but the provider has no record of it`);
      }
      return { outcome, newlyLinked: false };
    });
  }

  private conflict(paymentId: string, reason: string): PaymentRecordConflictException {
    this.logger.error(`Payment ${paymentId} needs manual review: ${reason}`);
    return new PaymentRecordConflictException(paymentId, reason);
  }

  private async update(paymentId: string, now: Date, change: (payment: Payment) => Change): Promise<Payment> {
    for (let attempt = 1; ; attempt++) {
      const payment = await this.payments.findById(paymentId);
      if (!payment) throw new PaymentNotFoundException();

      const statusBefore = payment.status;
      const { outcome, newlyLinked } = change(payment);

      if (!newlyLinked && outcome !== TransitionOutcome.APPLIED) {
        await this.payments.recordSynced(paymentId, now);
        return Payment.restore({ ...payment.toSnapshot(), lastSyncedAt: now });
      }

      payment.markSynced(now);
      // Queued only at the moment of the transition, in the same transaction as the status change: SUCCEEDED is final,
      // so this yields exactly one message per payment however many duplicate reports or racing requests there are.
      const messages = outcome === TransitionOutcome.APPLIED && payment.isSucceeded() ? [paymentSucceededMessage(payment)] : [];

      try {
        const saved = await this.payments.save(payment, messages);
        if (outcome === TransitionOutcome.APPLIED) {
          const reason = saved.failureCode ? ` (${saved.failureCode})` : '';
          this.logger.log(`Payment ${paymentId}: ${statusBefore} -> ${saved.status}${reason} [${saved.provider} ${saved.providerRef}]`);
        }
        return saved;
      } catch (error) {
        const lostTheRace = error instanceof PaymentConcurrentModificationError;
        if (!lostTheRace || attempt >= MAX_SAVE_ATTEMPTS) throw error;
      }
    }
  }
}
