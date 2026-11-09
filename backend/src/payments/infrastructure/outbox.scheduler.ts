import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PeriodicTask } from '../../common/scheduling/periodic-task';
import { AppConfig } from '../../config/configuration';
import { OutboxDispatcher } from '../application/outbox-dispatcher';

/**
 * Delivers queued outbox messages on a timer. All the logic is in OutboxDispatcher (which tests call directly);
 * this only decides WHEN. Single-instance assumption: several instances would be safe (handlers are idempotent)
 * but would duplicate work.
 */
@Injectable()
export class OutboxScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly task: PeriodicTask;

  constructor(dispatcher: OutboxDispatcher, config: ConfigService<AppConfig, true>) {
    const { outboxPollIntervalMs } = config.get('payments', { infer: true });
    this.task = new PeriodicTask(OutboxScheduler.name, () => dispatcher.dispatchDue(), outboxPollIntervalMs);
  }

  onApplicationBootstrap(): void {
    this.task.start();
  }

  onApplicationShutdown(): void {
    this.task.stop();
  }
}
