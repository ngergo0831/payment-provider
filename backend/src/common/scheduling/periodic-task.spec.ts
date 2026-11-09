import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { PeriodicTask } from './periodic-task';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('PeriodicTask', () => {
  let task: PeriodicTask | undefined;
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    task?.stop();
    jest.restoreAllMocks();
  });

  it('runs the job repeatedly until stopped', async () => {
    let runs = 0;
    task = new PeriodicTask('t', async () => void runs++, 10);
    task.start();

    await sleep(80);
    task.stop();
    const atStop = runs;
    await sleep(40);

    expect(atStop).toBeGreaterThanOrEqual(3);
    expect(runs).toBe(atStop); // nothing after stop()
  });

  it('is OFF when the interval is 0 (tests then trigger the job themselves)', async () => {
    let runs = 0;
    task = new PeriodicTask('t', async () => void runs++, 0);
    task.start();
    await sleep(40);
    expect(runs).toBe(0);
  });

  it('never overlaps with itself: a slow run delays the next one', async () => {
    let active = 0;
    let maxActive = 0;
    task = new PeriodicTask(
      't',
      async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await sleep(40);
        active--;
      },
      5,
    );
    task.start();

    await sleep(150);

    expect(maxActive).toBe(1);
  });

  it('survives a failing run: the error is logged and later runs still happen', async () => {
    let runs = 0;
    task = new PeriodicTask(
      't',
      async () => {
        runs++;
        if (runs === 1) throw new Error('first run fails');
      },
      10,
    );
    task.start();

    await sleep(80);

    expect(runs).toBeGreaterThanOrEqual(3);
    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
  });

  it('can be stopped even if it was never started', () => {
    task = new PeriodicTask('t', async () => undefined, 10);
    expect(() => task?.stop()).not.toThrow();
  });
});
