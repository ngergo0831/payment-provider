import { Injectable, Logger } from '@nestjs/common';
import { PAYMENT_SUCCEEDED, PaymentSucceededPayload } from './outbox';
import { CompanyGateway } from './ports/collaborators';
import { OutboxRepository, QueuedMessage } from './ports/repositories';

/**
 * A message is never abandoned: a lost `payment.succeeded` would mean a paid company is never activated. After this many
 * failures it is still retried (every MAX_DELAY_MS), but each failure is logged as an error, because it needs a person.
 */
export const ESCALATE_AFTER_ATTEMPTS = 10;
const BATCH_SIZE = 20;
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60_000;
const MAX_REASON_LENGTH = 500;

export function retryDelayMs(failedAttempts: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (failedAttempts - 1));
}

export interface DispatchReport {
  delivered: number;
  failed: number;
}

@Injectable()
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly companies: CompanyGateway,
  ) {}

  async dispatchDue(now: Date = new Date()): Promise<DispatchReport> {
    const due = await this.outbox.findDue(now, BATCH_SIZE);
    const report: DispatchReport = { delivered: 0, failed: 0 };

    for (const message of due) {
      try {
        await this.deliver(message);
        await this.outbox.markDelivered(message.id, now);
        report.delivered++;
      } catch (error) {
        const failedAttempts = message.attempts + 1;
        const reason = (error instanceof Error ? error.message : String(error)).slice(0, MAX_REASON_LENGTH);
        await this.outbox.markFailed(message.id, reason, new Date(now.getTime() + retryDelayMs(failedAttempts)));
        const summary = `Outbox message ${message.id} (${message.type}) failed, attempt ${failedAttempts}: ${reason}`;
        if (failedAttempts >= ESCALATE_AFTER_ATTEMPTS) {
          this.logger.error(
            `${summary}. Still failing after ${ESCALATE_AFTER_ATTEMPTS} attempts; retrying every ${MAX_DELAY_MS / 60_000} min.`,
          );
        } else {
          this.logger.warn(summary);
        }
        report.failed++;
      }
    }
    return report;
  }

  /** Delivery is at-least-once, so whatever a message triggers must be idempotent. There is one message type so far. */
  private async deliver(message: QueuedMessage): Promise<void> {
    if (message.type !== PAYMENT_SUCCEEDED) throw new Error(`No handler for message type "${message.type}"`);

    const companyId = (message.payload as Partial<PaymentSucceededPayload> | null | undefined)?.companyId;
    if (typeof companyId !== 'string') throw new Error('payment.succeeded message has no companyId');
    await this.companies.activate(companyId);
  }
}
