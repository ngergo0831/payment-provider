import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PeriodicTask } from '../../common/scheduling/periodic-task';
import { AppConfig } from '../../config/configuration';
import { OutboxDispatcher } from '../application/outbox-dispatcher';
import { ReconcilePaymentsUseCase } from '../application/use-cases/reconcile-payments.use-case';

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

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.tasks.map((task) => task.stop()));
  }
}
