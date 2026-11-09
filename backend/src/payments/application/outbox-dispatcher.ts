import { Inject, Injectable, Logger } from '@nestjs/common';
import { OutboxRepository } from './ports/repositories';

/** Knows how to act on one type of outbox message. Must be idempotent: delivery is at-least-once. */
export interface OutboxHandler {
  readonly type: string;
  handle(payload: unknown): Promise<void>;
}

export const OUTBOX_HANDLERS = Symbol('OUTBOX_HANDLERS');

export const MAX_ATTEMPTS = 10;
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
  private readonly handlers: Map<string, OutboxHandler>;

  constructor(
    private readonly outbox: OutboxRepository,
    @Inject(OUTBOX_HANDLERS) handlers: OutboxHandler[],
  ) {
    this.handlers = new Map(handlers.map((handler) => [handler.type, handler]));
  }

  async dispatchDue(now: Date = new Date()): Promise<DispatchReport> {
    const due = await this.outbox.findDue(now, MAX_ATTEMPTS, BATCH_SIZE);
    const report: DispatchReport = { delivered: 0, failed: 0 };

    for (const message of due) {
      try {
        const handler = this.handlers.get(message.type);
        if (!handler) throw new Error(`No handler for message type "${message.type}"`);

        await handler.handle(message.payload);
        await this.outbox.markDelivered(message.id, now);
        report.delivered++;
      } catch (error) {
        const failedAttempts = message.attempts + 1;
        const reason = (error instanceof Error ? error.message : String(error)).slice(0, MAX_REASON_LENGTH);
        await this.outbox.markFailed(message.id, reason, new Date(now.getTime() + retryDelayMs(failedAttempts)));
        this.logger.warn(`Outbox message ${message.id} (${message.type}) failed, attempt ${failedAttempts}/${MAX_ATTEMPTS}: ${reason}`);
        report.failed++;
      }
    }
    return report;
  }
}
