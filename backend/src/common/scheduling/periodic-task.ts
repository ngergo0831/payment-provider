import { Logger } from '@nestjs/common';

/**
 * Runs an async job every `intervalMs`, safely:
 *  - never overlaps with itself (a slow run delays the next one instead of piling up)
 *  - an error in one run is logged and does not stop later runs
 *  - never keeps the process alive on its own
 *  - an interval of 0 or less means "off" (tests trigger the job themselves, so they stay deterministic)
 *  - stop() waits for a run that is in progress, so shutdown never pulls the database out from under it
 */
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

  /** No new runs start; resolves once the current run (if any) has finished. */
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
