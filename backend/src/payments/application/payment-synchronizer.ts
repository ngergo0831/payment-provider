import { Injectable, Logger } from '@nestjs/common';
import { Money } from '../domain/money';
import { Payment, TransitionOutcome } from '../domain/payment';
import { ProviderPayment } from './ports/payment-provider';
import { PaymentConcurrentModificationError, PaymentRepository } from './ports/repositories';

/** The provider says it will charge a different amount than we asked for. Never proceed: it is a serious inconsistency. */
export class ProviderAmountMismatchError extends Error {
  constructor(paymentId: string, ours: Money, theirs: Money) {
    super(`Payment ${paymentId}: we asked for ${ours.toString()} but the provider reports ${theirs.toString()}`);
    this.name = 'ProviderAmountMismatchError';
  }
}

const MAX_ATTEMPTS = 3;

/**
 * THE one place that brings our record of a payment in line with the provider's.
 * Starting a payment, webhooks and reconciliation will all go through here, so every path to the same truth
 * obeys the same rules (the state machine) and the same safety checks.
 */
@Injectable()
export class PaymentSynchronizer {
  private readonly logger = new Logger(PaymentSynchronizer.name);

  constructor(private readonly payments: PaymentRepository) {}

  /**
   * Applies the provider's current record to our payment and returns the saved result.
   *
   * Safe to run concurrently for the same payment: if someone else saved first (optimistic lock), this re-reads the
   * newest version and applies the same provider snapshot again. That is correct because applying a snapshot is
   * idempotent (the state machine ignores what it already knows).
   */
  async apply(paymentId: string, remote: ProviderPayment): Promise<Payment> {
    for (let attempt = 1; ; attempt++) {
      const payment = await this.payments.findById(paymentId);
      if (!payment) throw new Error(`Payment ${paymentId} disappeared while synchronising`);

      if (!remote.amount.equals(payment.amount)) {
        throw new ProviderAmountMismatchError(paymentId, payment.amount, remote.amount);
      }

      const alreadyLinked = payment.providerRef === remote.providerRef;
      payment.attachProviderRef(remote.providerRef);
      const outcome = payment.applyStatus(remote.status, remote.failureCode);
      if (outcome === TransitionOutcome.REJECTED) {
        this.logger.warn(`Ignored stale report for payment ${paymentId}: ${payment.status} -> ${remote.status}`);
      }

      // A RETRY means someone saved just before us. If they already applied this same news, there is nothing left
      // to write: return their result instead of writing again (and possibly losing another race). Without this,
      // N simultaneous requests could need N-1 retries. The FIRST attempt always saves, to record the sync time.
      const changedAnything = !alreadyLinked || outcome === TransitionOutcome.APPLIED;
      if (attempt > 1 && !changedAnything) return payment;

      payment.markSynced();

      try {
        return await this.payments.save(payment);
      } catch (error) {
        const lostTheRace = error instanceof PaymentConcurrentModificationError;
        if (!lostTheRace || attempt >= MAX_ATTEMPTS) throw error;
        // Someone else saved first: loop, re-read the newest version, apply again.
      }
    }
  }
}
