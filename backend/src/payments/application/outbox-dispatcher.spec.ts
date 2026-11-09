import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { InMemoryOutbox } from '../../testing/in-memory-outbox';
import { MAX_ATTEMPTS, OutboxDispatcher, OutboxHandler, retryDelayMs } from './outbox-dispatcher';

const T0 = new Date('2026-11-09T12:00:00Z');
const after = (ms: number) => new Date(T0.getTime() + ms);

/** A handler that records what it received, and can be told to fail. */
function handlerFor(type: string) {
  const received: unknown[] = [];
  const handler: OutboxHandler & { failWith?: Error } = {
    type,
    async handle(payload) {
      if (handler.failWith) throw handler.failWith;
      received.push(payload);
    },
  };
  return { handler, received };
}

function setup() {
  const outbox = new InMemoryOutbox();
  const { handler, received } = handlerFor('thing.happened');
  return { outbox, handler, received, dispatcher: new OutboxDispatcher(outbox, [handler]) };
}

describe('OutboxDispatcher', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('delivers a due message to the handler for its type, and marks it delivered', async () => {
    const { outbox, dispatcher, received } = setup();
    const id = outbox.add('thing.happened', { n: 1 });

    const report = await dispatcher.dispatchDue(T0);

    expect(report).toEqual({ delivered: 1, failed: 0 });
    expect(received).toEqual([{ n: 1 }]);
    expect(outbox.row(id).deliveredAt).toEqual(T0);
  });

  it('delivers each message once: a delivered message is never picked up again', async () => {
    const { outbox, dispatcher, received } = setup();
    outbox.add('thing.happened');

    await dispatcher.dispatchDue(T0);
    await dispatcher.dispatchDue(after(60_000));

    expect(received).toHaveLength(1);
  });

  it('does nothing when there is nothing due', async () => {
    const { dispatcher } = setup();
    expect(await dispatcher.dispatchDue(T0)).toEqual({ delivered: 0, failed: 0 });
  });

  it('does not deliver a message before its time', async () => {
    const { outbox, dispatcher, received } = setup();
    outbox.add('thing.happened', {}, after(10_000));

    await dispatcher.dispatchDue(T0);

    expect(received).toEqual([]);
  });

  describe('when a handler fails', () => {
    it('records the reason, counts the attempt, and postpones the retry (5 s after the first failure)', async () => {
      const { outbox, dispatcher, handler } = setup();
      const id = outbox.add('thing.happened');
      handler.failWith = new Error('database hiccup');

      const report = await dispatcher.dispatchDue(T0);

      expect(report).toEqual({ delivered: 0, failed: 1 });
      expect(outbox.row(id)).toMatchObject({ lastError: 'database hiccup', availableAt: after(5_000), deliveredAt: null });
      expect(outbox.row(id).message.attempts).toBe(1);
    });

    it('does not retry before the delay is over, then delivers once the handler works again', async () => {
      const { outbox, dispatcher, handler, received } = setup();
      const id = outbox.add('thing.happened');
      handler.failWith = new Error('boom');
      await dispatcher.dispatchDue(T0);

      handler.failWith = undefined;
      await dispatcher.dispatchDue(after(4_000)); // too early
      expect(received).toEqual([]);

      await dispatcher.dispatchDue(after(5_000)); // due
      expect(received).toHaveLength(1);
      expect(outbox.row(id).deliveredAt).not.toBeNull();
    });

    it('waits longer after every failure', async () => {
      const { outbox, dispatcher, handler } = setup();
      const id = outbox.add('thing.happened');
      handler.failWith = new Error('boom');

      await dispatcher.dispatchDue(T0);
      expect(outbox.row(id).availableAt).toEqual(after(5_000));
      await dispatcher.dispatchDue(after(5_000));
      expect(outbox.row(id).availableAt).toEqual(after(5_000 + 10_000));
      await dispatcher.dispatchDue(after(15_000));
      expect(outbox.row(id).availableAt).toEqual(after(15_000 + 20_000));
    });

    it('never blocks the other messages: one bad message, the rest are still delivered', async () => {
      const { outbox, dispatcher, handler, received } = setup();
      outbox.add('thing.happened', { n: 1 });
      outbox.add('thing.happened', { n: 2 });
      outbox.add('thing.happened', { n: 3 });
      handler.failWith = undefined;
      jest.spyOn(handler, 'handle').mockImplementation(async (payload) => {
        if ((payload as { n: number }).n === 2) throw new Error('only this one fails');
        received.push(payload);
      });

      const report = await dispatcher.dispatchDue(T0);

      expect(report).toEqual({ delivered: 2, failed: 1 });
      expect(received).toEqual([{ n: 1 }, { n: 3 }]);
    });

    it('stops picking a message up after the maximum number of attempts, leaving it (and its error) for a person', async () => {
      const { outbox, dispatcher, handler } = setup();
      const id = outbox.add('thing.happened');
      handler.failWith = new Error('permanent problem');
      let now = T0;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await dispatcher.dispatchDue(now);
        now = new Date(now.getTime() + 10 * 60_000); // always past the back-off
      }
      const lastCall = await dispatcher.dispatchDue(now);

      expect(outbox.row(id).message.attempts).toBe(MAX_ATTEMPTS);
      expect(lastCall).toEqual({ delivered: 0, failed: 0 }); // no longer picked up
      expect(outbox.row(id)).toMatchObject({ deliveredAt: null, lastError: 'permanent problem' }); // still there, still explained
    });

    it('records a clear reason for a message type nobody handles (and keeps retrying, since a deploy may add the handler)', async () => {
      const { outbox, dispatcher } = setup();
      const id = outbox.add('mystery.event');

      const report = await dispatcher.dispatchDue(T0);

      expect(report).toEqual({ delivered: 0, failed: 1 });
      expect(outbox.row(id).lastError).toMatch(/No handler for message type "mystery.event"/);
    });

    it('keeps the stored reason short', async () => {
      const { outbox, dispatcher, handler } = setup();
      const id = outbox.add('thing.happened');
      handler.failWith = new Error('x'.repeat(5000));

      await dispatcher.dispatchDue(T0);

      expect(outbox.row(id).lastError).toHaveLength(500);
    });
  });

  describe('at-least-once delivery', () => {
    it('delivers AGAIN when the crash happened after the handler ran but before the message was marked delivered', async () => {
      const { outbox, dispatcher, received } = setup();
      outbox.add('thing.happened', { n: 1 });
      outbox.failNextMarkDelivered = true;

      await dispatcher.dispatchDue(T0); // handler ran, marking failed: recorded as a failure
      await dispatcher.dispatchDue(after(5_000));

      expect(received).toHaveLength(2); // the handler saw it twice. That is why handlers must be idempotent.
    });
  });
});

describe('retryDelayMs', () => {
  it.each([
    [1, 5_000],
    [2, 10_000],
    [3, 20_000],
    [4, 40_000],
    [5, 80_000],
    [6, 160_000],
    [7, 300_000], // capped at 5 minutes
    [20, 300_000],
  ])('after failure %d waits %d ms', (failures, expected) => {
    expect(retryDelayMs(failures)).toBe(expected);
  });
});
