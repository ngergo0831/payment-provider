import { randomUUID } from 'node:crypto';
import { OutboxDispatcher } from '../src/payments/application/outbox-dispatcher';
import { PaymentProvider } from '../src/payments/application/ports/payment-provider';
import { PaymentRepository } from '../src/payments/application/ports/repositories';
import { ReconcilePaymentsUseCase } from '../src/payments/application/use-cases/reconcile-payments.use-case';
import { MockOutcome, MockPaymentProvider } from '../src/payments/infrastructure/providers/mock-payment.provider';
import { companyStatus, registerCompany, waitForActivation } from './support/companies';
import { createTestApp, queryDatabase, TestApp } from './support/test-app';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

describe('reconciliation (real PostgreSQL)', () => {
  let t: TestApp;
  let provider: MockPaymentProvider;

  beforeAll(async () => {
    t = await createTestApp();
    provider = t.app.get(PaymentProvider) as MockPaymentProvider;
  });
  afterAll(async () => {
    await t.close();
  });

  describe('which payments are due (the real query)', () => {
    // Its own database: the seeded rows point at provider references that do not exist, so they must not leak into other tests.
    let q: TestApp;
    beforeAll(async () => {
      q = await createTestApp();
    });
    afterAll(async () => {
      await q.close();
    });

    /** Inserts a payment row with exact timestamps and returns its id. */
    const seed = async (columns: { status?: string; providerRef?: string | null; createdMinutesAgo: number; syncedMinutesAgo?: number }) => {
      const { companyId } = await registerCompany(q);
      const id: string = randomUUID();
      const ref = columns.providerRef === undefined ? `pi_${id}` : columns.providerRef;
      await queryDatabase(
        q.databaseUrl,
        `INSERT INTO payments (id, company_id, provider, provider_ref, amount_minor, currency, status, created_at, updated_at, last_synced_at)
         VALUES ('${id}', '${companyId}', 'mock', ${ref === null ? 'NULL' : `'${ref}'`}, 4900, 'USD', '${columns.status ?? 'CREATED'}',
                 '${ago(columns.createdMinutesAgo)}', '${ago(columns.createdMinutesAgo)}',
                 ${columns.syncedMinutesAgo === undefined ? 'NULL' : `'${ago(columns.syncedMinutesAgo)}'`})`,
      );
      return id;
    };
    const due = async (limit = 100) =>
      (await q.app.get(PaymentRepository).findDueForReconciliation({
        notSyncedSince: new Date(Date.now() - 2 * 60_000),
        createdAfter: new Date(Date.now() - 24 * 60 * 60_000),
        limit,
      })).map((payment) => payment.id);

    it('includes open, linked payments that have been quiet, and excludes everything else', async () => {
      const neverSynced = await seed({ createdMinutesAgo: 10 });
      const syncedLongAgo = await seed({ createdMinutesAgo: 60, syncedMinutesAgo: 5 });
      const failedButOpen = await seed({ status: 'FAILED', createdMinutesAgo: 10 });
      const syncedJustNow = await seed({ createdMinutesAgo: 60, syncedMinutesAgo: 1 });
      const notLinkedYet = await seed({ createdMinutesAgo: 10, providerRef: null });
      const alreadyPaid = await seed({ status: 'SUCCEEDED', createdMinutesAgo: 10 });
      const canceled = await seed({ status: 'CANCELED', createdMinutesAgo: 10 });
      const abandoned = await seed({ createdMinutesAgo: 30 * 60 });

      const result = await due();

      expect(result).toEqual(expect.arrayContaining([neverSynced, syncedLongAgo, failedButOpen]));
      for (const excluded of [syncedJustNow, notLinkedYet, alreadyPaid, canceled, abandoned]) {
        expect(result).not.toContain(excluded);
      }
    });

    it('puts the least recently synced first, so no payment starves behind busier ones', async () => {
      const oldest = await seed({ createdMinutesAgo: 100, syncedMinutesAgo: 90 });
      const middle = await seed({ createdMinutesAgo: 100, syncedMinutesAgo: 20 });
      const newest = await seed({ createdMinutesAgo: 100, syncedMinutesAgo: 5 });

      const order = (await due()).filter((id) => [oldest, middle, newest].includes(id));

      expect(order).toEqual([oldest, middle, newest]);
    });

    it('respects the batch limit', async () => {
      await seed({ createdMinutesAgo: 10 });
      await seed({ createdMinutesAgo: 10 });
      await seed({ createdMinutesAgo: 10 });
      expect((await due(2)).length).toBe(2);
    });
  });

  describe('recovering from a lost webhook, end to end', () => {
    it('finds the success on its own, queues the message, and the company is activated', async () => {
      const company = await registerCompany(t);
      const { auth } = company;
      const { body } = await t.http.post('/payments').set(auth).expect(200);
      provider.simulate(body.payment.providerRef, MockOutcome.SUCCEED); // the webhook never arrives
      // Make it look like it has been quiet for a while.
      await queryDatabase(t.databaseUrl, `UPDATE payments SET created_at = '${ago(10)}', last_synced_at = '${ago(10)}' WHERE id = '${body.payment.id}'`);

      const report = await t.app.get(ReconcilePaymentsUseCase).execute();
      expect(report.failed).toBe(0);
      expect(report.checked).toBeGreaterThanOrEqual(1);

      const payment = (await t.http.get(`/payments/${body.payment.id}`).set(auth).expect(200)).body;
      expect(payment.status).toBe('SUCCEEDED');
      await t.app.get(OutboxDispatcher).dispatchDue();
      expect(await companyStatus(t, company)).toBe('ACTIVE');
    });

    it('survives a provider outage and recovers on the next run', async () => {
      const { auth } = await registerCompany(t);
      const { body } = await t.http.post('/payments').set(auth).expect(200);
      provider.simulate(body.payment.providerRef, MockOutcome.SUCCEED);
      await queryDatabase(t.databaseUrl, `UPDATE payments SET created_at = '${ago(10)}', last_synced_at = '${ago(10)}' WHERE id = '${body.payment.id}'`);

      provider.setOutage(true);
      const down = await t.app.get(ReconcilePaymentsUseCase).execute();
      provider.setOutage(false);

      expect(down.failed).toBeGreaterThanOrEqual(1);
      expect((await t.http.get(`/payments/${body.payment.id}`).set(auth).expect(200)).body.status).toBe('CREATED');

      await t.app.get(ReconcilePaymentsUseCase).execute();
      expect((await t.http.get(`/payments/${body.payment.id}`).set(auth).expect(200)).body.status).toBe('SUCCEEDED');
    });
  });

  describe('the background timers', () => {
    it('with both timers on, a payment whose webhook was lost activates the company with no manual step', async () => {
      const timed = await createTestApp({ env: { RECONCILE_INTERVAL_MS: '50', OUTBOX_POLL_INTERVAL_MS: '50' } });
      try {
        const timedProvider = timed.app.get(PaymentProvider) as MockPaymentProvider;
        const company = await registerCompany(timed);
        const { body } = await timed.http.post('/payments').set(company.auth).expect(200);
        timedProvider.simulate(body.payment.providerRef, MockOutcome.SUCCEED); // webhook lost
        await queryDatabase(timed.databaseUrl, `UPDATE payments SET created_at = '${ago(10)}', last_synced_at = '${ago(10)}' WHERE id = '${body.payment.id}'`);

        expect(await waitForActivation(timed, company)).toBe('ACTIVE');
      } finally {
        await timed.close();
      }
    });
  });
});
