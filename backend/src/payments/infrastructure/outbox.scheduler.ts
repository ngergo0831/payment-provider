import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { OutboxDispatcher } from '../application/outbox-dispatcher';

/**
 * Runs the dispatcher on a timer. Deliberately tiny: all the logic is in OutboxDispatcher, which tests call directly.
 * Single-instance assumption: several instances would be safe (handlers are idempotent) but would duplicate work.
 */
@Injectable()
export class OutboxScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly dispatcher: OutboxDispatcher,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap(): void {
    const intervalMs = this.config.get('payments', { infer: true }).outboxPollIntervalMs;
    if (intervalMs <= 0) return; // timer off

    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref(); // never keeps the process alive on its own
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // a slow run must not overlap with the next one
    this.running = true;
    try {
      await this.dispatcher.dispatchDue();
    } catch (error) {
      this.logger.error('Outbox delivery run failed', (error as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
