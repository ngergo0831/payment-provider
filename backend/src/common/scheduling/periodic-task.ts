import { Logger } from '@nestjs/common';

export class PeriodicTask {
  private readonly logger: Logger;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;

  constructor(
    name: string,
    private readonly job: () => Promise<unknown>,
    private readonly intervalMs: number,
  ) {
    this.logger = new Logger(name);
  }

  start(): void {
    if (this.intervalMs <= 0) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  private tick(): void {
    if (this.inFlight) return;
    this.inFlight = this.job()
      .then(
        () => undefined,
        (error: unknown) => this.logger.error('Scheduled run failed', (error as Error).stack),
      )
      .finally(() => {
        this.inFlight = undefined;
      });
  }
}
