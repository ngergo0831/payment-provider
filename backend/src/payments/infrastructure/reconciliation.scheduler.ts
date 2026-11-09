import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PeriodicTask } from '../../common/scheduling/periodic-task';
import { AppConfig } from '../../config/configuration';
import { ReconcilePaymentsUseCase } from '../application/use-cases/reconcile-payments.use-case';

/** Runs reconciliation on a timer (once a minute by default). Single-instance assumption, like the outbox timer. */
@Injectable()
export class ReconciliationScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly task: PeriodicTask;

  constructor(reconcile: ReconcilePaymentsUseCase, config: ConfigService<AppConfig, true>) {
    const { reconcileIntervalMs } = config.get('payments', { infer: true });
    this.task = new PeriodicTask(ReconciliationScheduler.name, () => reconcile.execute(), reconcileIntervalMs);
  }

  onApplicationBootstrap(): void {
    this.task.start();
  }

  onApplicationShutdown(): void {
    this.task.stop();
  }
}
