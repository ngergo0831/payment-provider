import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PeriodicTask } from '../../common/scheduling/periodic-task';
import { AppConfig } from '../../config/configuration';
import { OutboxDispatcher } from '../application/outbox-dispatcher';
import { ReconcilePaymentsUseCase } from '../application/use-cases/reconcile-payments.use-case';

/**
 * The payment module's timers: deliver queued outbox messages, and reconcile payments whose webhook never came.
 * All the logic lives in the dispatcher and the use case (which tests call directly); this only decides WHEN.
 * An interval of 0 turns a job off.
 *
 * Single-instance assumption: several instances would be safe (every step is idempotent) but would duplicate work.
 */
@Injectable()
export class PaymentBackgroundJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly tasks: PeriodicTask[];

  constructor(dispatcher: OutboxDispatcher, reconcile: ReconcilePaymentsUseCase, config: ConfigService<AppConfig, true>) {
    const { outboxPollIntervalMs, reconcileIntervalMs } = config.get('payments', { infer: true });
    this.tasks = [
      new PeriodicTask('OutboxDelivery', () => dispatcher.dispatchDue(), outboxPollIntervalMs),
      new PeriodicTask('Reconciliation', () => reconcile.execute(), reconcileIntervalMs),
    ];
  }

  onApplicationBootstrap(): void {
    this.tasks.forEach((task) => task.start());
  }

  onApplicationShutdown(): void {
    this.tasks.forEach((task) => task.stop());
  }
}
