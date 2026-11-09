import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { ActivateCompanyUseCase } from '../src/onboarding/application/activate-company.use-case';
import { OutboxDispatcher } from '../src/payments/application/outbox-dispatcher';
import { PaymentProvider } from '../src/payments/application/ports/payment-provider';
import { MockOutcome, MockPaymentProvider } from '../src/payments/infrastructure/providers/mock-payment.provider';
import { companyStatus, registerCompany, waitForActivation } from './support/companies';
import { createTestApp, queryDatabase, TestApp } from './support/test-app';

/** register -> pay -> (provider says paid) -> message delivered -> company ACTIVE */
describe('the full payment flow (real HTTP + PostgreSQL)', () => {
  let t: TestApp;
  let provider: MockPaymentProvider;
  let dispatcher: OutboxDispatcher;

  beforeAll(async () => {
    t = await createTestApp();
    provider = t.app.get(PaymentProvider) as MockPaymentProvider;
    dispatcher = t.app.get(OutboxDispatcher);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const newAdmin = async () => {
    const company = await registerCompany(t);
    return {
      companyId: company.companyId,
      start: () => t.http.post('/payments').set(company.auth),
      companyStatus: () => companyStatus(t, company),
      outbox: () =>
        queryDatabase<{ id: string; processed_at: Date | null; attempts: number; last_error: string | null; available_at: Date }>(
          t.databaseUrl,
          `SELECT id, processed_at, attempts, last_error, available_at FROM outbox_messages WHERE payload->>'companyId' = '${company.companyId}'`,
        ),
    };
  };
  /** The provider reports the payment as paid, and our side notices (here: the customer resumes checkout). */
  const payAndNotice = async (admin: Awaited<ReturnType<typeof newAdmin>>) => {
    const { body } = await admin.start().expect(200);
    provider.simulate(body.payment.providerRef, MockOutcome.SUCCEED);
    await admin.start().expect(200);
    return body.payment.id as string;
  };

  it('activates the company after the provider confirms payment and the queued message is delivered', async () => {
    const admin = await newAdmin();
    expect(await admin.companyStatus()).toBe('PENDING_PAYMENT');

    await payAndNotice(admin);

    // The payment is SUCCEEDED and the message is queued, but delivery has not happened yet.
    expect(await admin.companyStatus()).toBe('PENDING_PAYMENT');
    expect(await admin.outbox()).toHaveLength(1);

    expect(await dispatcher.dispatchDue()).toEqual({ delivered: 1, failed: 0 });

    expect(await admin.companyStatus()).toBe('ACTIVE');
    const [message] = await admin.outbox();
    expect(message.processed_at).toBeInstanceOf(Date);
  });

  it('after activation there is nothing left to pay (409), and nothing more to deliver', async () => {
    const admin = await newAdmin();
    await payAndNotice(admin);
    await dispatcher.dispatchDue();

    expect((await admin.start().expect(409)).body.code).toBe('COMPANY_ALREADY_ACTIVE');
    expect(await dispatcher.dispatchDue()).toEqual({ delivered: 0, failed: 0 });
  });

  it('does not activate a company whose payment failed, was declined, or is still pending', async () => {
    const declined = await newAdmin();
    const declinedStart = await declined.start().expect(200);
    provider.simulate(declinedStart.body.payment.providerRef, MockOutcome.DECLINE);
    await declined.start().expect(200);

    const pending = await newAdmin();
    await pending.start().expect(200);

    await dispatcher.dispatchDue();

    expect(await declined.companyStatus()).toBe('PENDING_PAYMENT');
    expect(await pending.companyStatus()).toBe('PENDING_PAYMENT');
    expect(await declined.outbox()).toHaveLength(0);
  });

  it('only the paying company is activated, not others', async () => {
    const payer = await newAdmin();
    const bystander = await newAdmin();
    await bystander.start().expect(200);

    await payAndNotice(payer);
    await dispatcher.dispatchDue();

    expect(await payer.companyStatus()).toBe('ACTIVE');
    expect(await bystander.companyStatus()).toBe('PENDING_PAYMENT');
  });

  describe('when delivering the message fails', () => {
    it('keeps the message, records the error, retries after a delay, and activates once it works: nothing is lost', async () => {
      const admin = await newAdmin();
      await payAndNotice(admin);
      jest.spyOn(t.app.get(ActivateCompanyUseCase), 'execute').mockRejectedValueOnce(new Error('database hiccup while activating'));

      const failed = await dispatcher.dispatchDue();

      expect(failed).toEqual({ delivered: 0, failed: 1 });
      expect(await admin.companyStatus()).toBe('PENDING_PAYMENT');
      const [afterFailure] = await admin.outbox();
      expect(afterFailure).toMatchObject({ processed_at: null, attempts: 1, last_error: 'database hiccup while activating' });
      expect(afterFailure.available_at.getTime()).toBeGreaterThan(Date.now()); // postponed

      expect(await dispatcher.dispatchDue()).toEqual({ delivered: 0, failed: 0 }); // not due yet: no hammering

      const later = new Date(Date.now() + 60_000);
      expect(await dispatcher.dispatchDue(later)).toEqual({ delivered: 1, failed: 0 });
      expect(await admin.companyStatus()).toBe('ACTIVE');
    });

    it('is safe if the same message is delivered twice (activation is idempotent)', async () => {
      const admin = await newAdmin();
      await payAndNotice(admin);
      await dispatcher.dispatchDue();
      const [{ id }] = await admin.outbox();
      const activatedAt = await queryDatabase<{ activated_at: Date }>(t.databaseUrl, `SELECT activated_at FROM companies WHERE id = '${admin.companyId}'`);

      // Simulate "crashed before marking it delivered": the same message becomes due again.
      await queryDatabase(t.databaseUrl, `UPDATE outbox_messages SET processed_at = NULL WHERE id = '${id}'`);
      expect(await dispatcher.dispatchDue()).toEqual({ delivered: 1, failed: 0 });

      const again = await queryDatabase<{ activated_at: Date }>(t.databaseUrl, `SELECT activated_at FROM companies WHERE id = '${admin.companyId}'`);
      expect(again).toEqual(activatedAt); // the activation time did not move
      expect(await admin.companyStatus()).toBe('ACTIVE');
    });
  });

  describe('the background timer', () => {
    it('delivers by itself when the timer is on: no manual dispatch needed', async () => {
      const timed = await createTestApp({ env: { OUTBOX_POLL_INTERVAL_MS: '50' } });
      try {
        const timedProvider = timed.app.get(PaymentProvider) as MockPaymentProvider;
        const company = await registerCompany(timed);
        const start = await timed.http.post('/payments').set(company.auth).expect(200);
        timedProvider.simulate(start.body.payment.providerRef, MockOutcome.SUCCEED);
        await timed.http.post('/payments').set(company.auth).expect(200);

        expect(await waitForActivation(timed, company)).toBe('ACTIVE');
      } finally {
        await timed.close();
      }
    });
  });
});
