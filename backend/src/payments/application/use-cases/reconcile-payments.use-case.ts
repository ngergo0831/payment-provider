import { Injectable, Logger } from '@nestjs/common';
import { PaymentSynchronizer } from '../payment-synchronizer';
import { PaymentProvider } from '../ports/payment-provider';
import { PaymentRepository } from '../ports/repositories';

/** Give the webhook time to arrive first: a payment synchronised within this long is left alone. */
const QUIET_FOR_MS = 2 * 60_000;
/** Older payments are abandoned checkouts: stop asking the provider about them. */
const MAX_AGE_MS = 24 * 3_600_000;
const BATCH_SIZE = 50;

export interface ReconciliationReport {
  checked: number;
  failed: number;
}

/**
 * The safety net for lost or very late webhooks: asks the provider directly about open payments that have been quiet
 * for a while. It goes through the same synchronizer as webhooks, so it follows exactly the same rules, and if it
 * finds a success it queues the same "payment succeeded" message.
 */
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
      notSyncedSince: new Date(now.getTime() - QUIET_FOR_MS),
      createdAfter: new Date(now.getTime() - MAX_AGE_MS),
      limit: BATCH_SIZE,
    });

    let failed = 0;
    for (const payment of due) {
      try {
        const remote = await this.provider.retrievePayment(payment.providerRef as string);
        await this.synchronizer.apply(payment.id, remote, now); // the same "now" end to end: one clock per run
      } catch (error) {
        // One payment (or a provider outage) must not stop the others. It stays due and is tried again next run.
        failed++;
        this.logger.warn(`Reconciling payment ${payment.id} failed: ${(error as Error).message}`);
      }
    }
    return { checked: due.length, failed };
  }
}
