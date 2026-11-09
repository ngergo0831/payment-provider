import { Logger } from '@nestjs/common';

/**
 * Runs an async job every `intervalMs`, safely:
 *  - never overlaps with itself (a slow run delays the next one instead of piling up)
 *  - an error in one run is logged and does not stop later runs
 *  - never keeps the process alive on its own
 *  - an interval of 0 or less means "off" (tests trigger the job themselves, so they stay deterministic)
 */
export class PeriodicTask {
  private readonly logger: Logger;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    name: string,
    private readonly job: () => Promise<unknown>,
    private readonly intervalMs: number,
  ) {
    this.logger = new Logger(name);
  }

  start(): void {
    if (this.intervalMs <= 0) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.job();
    } catch (error) {
      this.logger.error('Scheduled run failed', (error as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
