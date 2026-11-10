import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
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
export class PaymentBackgroundJobs implements OnApplicationBootstrap, OnModuleDestroy {
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

  /**
   * Stops the timers and waits for runs in progress. Module destruction is the first shutdown phase, so this finishes
   * before the database connection is closed (TypeORM does that in the last phase, onApplicationShutdown).
   */
  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.tasks.map((task) => task.stop()));
  }
}
