import { Injectable, Logger } from '@nestjs/common';
import { Payment } from '../../domain/payment';
import { PaymentRecordConflictException } from '../payment-record-conflict.exception';
import { PaymentSynchronizer } from '../payment-synchronizer';
import { PaymentProvider, ProviderPaymentNotFoundError } from '../ports/payment-provider';
import { PaymentRepository } from '../ports/repositories';

// A payment is checked once it has been quiet for 2 minutes or a tenth of its age, whichever is longer: a fresh one
// every few minutes, a day-old one every 2.4 h. FAILED payments stay in: the customer can still retry them in the browser.
const MIN_QUIET_MS = 2 * 60_000;
const QUIET_FRACTION_OF_AGE = 0.1;
// Long enough for slow methods such as SEPA debits, which can stay PROCESSING for up to 14 business days.
const MAX_AGE_MS = 30 * 24 * 3_600_000;
const BATCH_SIZE = 50;

export interface ReconciliationReport {
  checked: number;
  failed: number;
}

@Injectable()
export class ReconcilePaymentsUseCase {
  private readonly logger = new Logger(ReconcilePaymentsUseCase.name);

  constructor(
    private readonly provider: PaymentProvider,
    private readonly payments: PaymentRepository,
    private readonly synchronizer: PaymentSynchronizer,
  ) {}

  async execute(now: Date = new Date()): Promise<ReconciliationReport> {
    const due = await this.payments.findDueForReconciliation({
      provider: this.provider.name,
      now,
      minQuietMs: MIN_QUIET_MS,
      quietFractionOfAge: QUIET_FRACTION_OF_AGE,
      createdAfter: new Date(now.getTime() - MAX_AGE_MS),
      limit: BATCH_SIZE,
    });

    let failed = 0;
    for (const payment of due) {
      try {
        await this.reconcile(payment, now);
      } catch (error) {
        failed++;
        // A conflict was already logged as an error, with its reason.
        if (!(error instanceof PaymentRecordConflictException)) {
          this.logger.warn(`Reconciling payment ${payment.id} failed: ${(error as Error).message}`);
        }
      }
    }
    return { checked: due.length, failed };
  }

  private async reconcile(payment: Payment, now: Date): Promise<void> {
    try {
      const remote = await this.provider.retrievePayment(payment.providerRef as string);
      await this.synchronizer.apply(payment.id, remote, now);
    } catch (error) {
      if (!(error instanceof ProviderPaymentNotFoundError)) throw error;
      await this.synchronizer.retire(payment.id, now);
    }
  }
}
