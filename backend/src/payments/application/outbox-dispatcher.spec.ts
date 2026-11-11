import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { InMemoryOutbox } from '../../testing/in-memory-outbox';
import { FakeCompanyGateway } from '../../testing/in-memory-payments';
import { PAYMENT_SUCCEEDED } from './outbox';
import { ESCALATE_AFTER_ATTEMPTS, OutboxDispatcher, retryDelayMs } from './outbox-dispatcher';

const T0 = new Date('2026-11-09T12:00:00Z');
const after = (ms: number) => new Date(T0.getTime() + ms);

function setup() {
  const outbox = new InMemoryOutbox();
  const companies = new FakeCompanyGateway();
  const succeeded = (companyId = 'company-1', availableAt?: Date) =>
    outbox.add(PAYMENT_SUCCEEDED, { paymentId: `payment-of-${companyId}`, companyId }, availableAt);
  return { outbox, companies, succeeded, dispatcher: new OutboxDispatcher(outbox, companies) };
}

describe('OutboxDispatcher', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('delivers a due "payment succeeded" message by activating its company, and marks it delivered', async () => {
    const { outbox, dispatcher, companies, succeeded } = setup();
    const id = succeeded('company-7');

    const report = await dispatcher.dispatchDue(T0);

    expect(report).toEqual({ delivered: 1, failed: 0 });
    expect(companies.activated).toEqual(['company-7']);
    expect(outbox.row(id).deliveredAt).toEqual(T0);
  });

  it('delivers each message once: a delivered message is never picked up again', async () => {
    const { dispatcher, companies, succeeded } = setup();
    succeeded();

    await dispatcher.dispatchDue(T0);
    await dispatcher.dispatchDue(after(60_000));

    expect(companies.activated).toHaveLength(1);
  });

  it('does nothing when there is nothing due', async () => {
    const { dispatcher } = setup();
    expect(await dispatcher.dispatchDue(T0)).toEqual({ delivered: 0, failed: 0 });
  });

  it('does not deliver a message before its time', async () => {
    const { dispatcher, companies, succeeded } = setup();
    succeeded('company-1', after(10_000));

    await dispatcher.dispatchDue(T0);

    expect(companies.activated).toEqual([]);
  });

  describe('when delivery fails', () => {
    it('records the reason, counts the attempt, and postpones the retry (5 s after the first failure)', async () => {
      const { outbox, dispatcher, companies, succeeded } = setup();
      const id = succeeded();
      companies.failActivationWith = new Error('database hiccup');

      const report = await dispatcher.dispatchDue(T0);

      expect(report).toEqual({ delivered: 0, failed: 1 });
      expect(outbox.row(id)).toMatchObject({ lastError: 'database hiccup', availableAt: after(5_000), deliveredAt: null });
      expect(outbox.row(id).message.attempts).toBe(1);
    });

    it('does not retry before the delay is over, then delivers once activation works again', async () => {
      const { outbox, dispatcher, companies, succeeded } = setup();
      const id = succeeded();
      companies.failActivationWith = new Error('boom');
      await dispatcher.dispatchDue(T0);

      companies.failActivationWith = undefined;
      await dispatcher.dispatchDue(after(4_000));
      expect(companies.activated).toEqual([]);

      await dispatcher.dispatchDue(after(5_000));
      expect(companies.activated).toHaveLength(1);
      expect(outbox.row(id).deliveredAt).not.toBeNull();
    });

    it('waits longer after every failure', async () => {
      const { outbox, dispatcher, companies, succeeded } = setup();
      const id = succeeded();
      companies.failActivationWith = new Error('boom');

      await dispatcher.dispatchDue(T0);
      expect(outbox.row(id).availableAt).toEqual(after(5_000));
      await dispatcher.dispatchDue(after(5_000));
      expect(outbox.row(id).availableAt).toEqual(after(5_000 + 10_000));
      await dispatcher.dispatchDue(after(15_000));
      expect(outbox.row(id).availableAt).toEqual(after(15_000 + 20_000));
    });

    it('never blocks the other messages: one bad message, the rest are still delivered', async () => {
      const { outbox, dispatcher, companies, succeeded } = setup();
      succeeded('company-1');
      outbox.add(PAYMENT_SUCCEEDED, { paymentId: 'p-2' });
      succeeded('company-3');

      const report = await dispatcher.dispatchDue(T0);

      expect(report).toEqual({ delivered: 2, failed: 1 });
      expect(companies.activated).toEqual(['company-1', 'company-3']);
    });

    it('never gives up on a message: past the escalation point every failure is an error log, and it is still delivered once fixed', async () => {
      const { outbox, dispatcher, companies, succeeded } = setup();
      const id = succeeded();
      companies.failActivationWith = new Error('permanent problem');
      const errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      let now = T0;
      const tick = async () => {
        await dispatcher.dispatchDue(now);
        now = new Date(now.getTime() + 10 * 60_000);
      };

      for (let attempt = 1; attempt < ESCALATE_AFTER_ATTEMPTS; attempt++) await tick();
      expect(errors).not.toHaveBeenCalled();
      await tick();
      await tick();
      expect(errors).toHaveBeenCalledTimes(2);
      expect(errors).toHaveBeenLastCalledWith(expect.stringContaining('permanent problem'));
      expect(outbox.row(id).message.attempts).toBe(ESCALATE_AFTER_ATTEMPTS + 1);

      companies.failActivationWith = undefined;
      await tick();
      expect(companies.activated).toHaveLength(1);
      expect(outbox.row(id).deliveredAt).not.toBeNull();
    });

    it.each([[null], [undefined], [{}], [{ paymentId: 'p1' }], [{ companyId: 42 }], ['text']])(
      'refuses a malformed message %j instead of activating nobody silently',
      async (payload) => {
        const { outbox, dispatcher, companies } = setup();
        const id = outbox.add(PAYMENT_SUCCEEDED, payload);

        expect(await dispatcher.dispatchDue(T0)).toEqual({ delivered: 0, failed: 1 });

        expect(outbox.row(id).lastError).toMatch(/no companyId/);
        expect(companies.activated).toEqual([]);
      },
    );

    it('records a clear reason for a message type nobody handles (and keeps retrying, since a deploy may add the handler)', async () => {
      const { outbox, dispatcher } = setup();
      const id = outbox.add('mystery.event');

      const report = await dispatcher.dispatchDue(T0);

      expect(report).toEqual({ delivered: 0, failed: 1 });
      expect(outbox.row(id).lastError).toMatch(/No handler for message type "mystery.event"/);
    });

    it('keeps the stored reason short', async () => {
      const { outbox, dispatcher, companies, succeeded } = setup();
      const id = succeeded();
      companies.failActivationWith = new Error('x'.repeat(5000));

      await dispatcher.dispatchDue(T0);

      expect(outbox.row(id).lastError).toHaveLength(500);
    });
  });

  describe('at-least-once delivery', () => {
    it('activates AGAIN when the crash happened after activation but before the message was marked delivered', async () => {
      const { outbox, dispatcher, companies, succeeded } = setup();
      succeeded();
      outbox.failNextMarkDelivered = true;

      await dispatcher.dispatchDue(T0);
      await dispatcher.dispatchDue(after(5_000));

      expect(companies.activated).toHaveLength(2);
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
    [7, 300_000],
    [20, 300_000],
  ])('after failure %d waits %d ms', (failures, expected) => {
    expect(retryDelayMs(failures)).toBe(expected);
  });
});
