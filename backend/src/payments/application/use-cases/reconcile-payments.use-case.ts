import { Injectable, Logger } from '@nestjs/common';
import { PaymentSynchronizer } from '../payment-synchronizer';
import { PaymentProvider } from '../ports/payment-provider';
import { PaymentRepository } from '../ports/repositories';

const QUIET_FOR_MS = 2 * 60_000;
const MAX_AGE_MS = 24 * 3_600_000;
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
      notSyncedSince: new Date(now.getTime() - QUIET_FOR_MS),
      createdAfter: new Date(now.getTime() - MAX_AGE_MS),
      limit: BATCH_SIZE,
    });

    let failed = 0;
    for (const payment of due) {
      try {
        const remote = await this.provider.retrievePayment(payment.providerRef as string);
        await this.synchronizer.apply(payment.id, remote, now);
      } catch (error) {
        failed++;
        this.logger.warn(`Reconciling payment ${payment.id} failed: ${(error as Error).message}`);
      }
    }
    return { checked: due.length, failed };
  }
}
