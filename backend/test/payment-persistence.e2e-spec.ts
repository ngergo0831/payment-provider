import { CompanyRepository } from '../src/onboarding/application/company.repository';
import { Company } from '../src/onboarding/domain/company.entity';
import {
  LivePaymentAlreadyExistsError,
  PaymentConcurrentModificationError,
  PaymentRepository,
} from '../src/payments/application/ports/repositories';
import { Money } from '../src/payments/domain/money';
import { Payment } from '../src/payments/domain/payment';
import { PaymentStatus } from '../src/payments/domain/payment-status';
import { createTestApp, queryDatabase, TestApp } from './support/test-app';

describe('payment persistence (real PostgreSQL)', () => {
  let t: TestApp;
  let payments: PaymentRepository;
  let counter = 0;

  const newCompany = async (): Promise<string> => {
    const company = Company.register({ name: `Co ${++counter}`, country: 'HU', billingEmail: 'a@b.co' });
    await t.app.get(CompanyRepository).save(company);
    return company.id;
  };
  const newPayment = (companyId: string, amount = Money.of(4900, 'USD')) => Payment.start({ companyId, provider: 'mock', amount });
  const stored = async (companyId: string, status: PaymentStatus = PaymentStatus.CREATED) => {
    const payment = newPayment(companyId);
    if (status !== PaymentStatus.CREATED) payment.applyStatus(status);
    await payments.insert(payment);
    return payment;
  };

  beforeAll(async () => {
    t = await createTestApp();
    payments = t.app.get(PaymentRepository);
  });
  afterAll(async () => {
    await t.close();
  });

  describe('storing and loading', () => {
    it('round-trips every field', async () => {
      const companyId = await newCompany();
      const payment = newPayment(companyId);
      payment.attachProviderRef('pi_roundtrip');
      payment.applyStatus(PaymentStatus.FAILED, 'card_declined');
      payment.markSynced(new Date('2026-11-09T10:00:00Z'));
      await payments.insert(payment);

      const loaded = await payments.findById(payment.id);

      expect(loaded?.toSnapshot()).toEqual(payment.toSnapshot());
    });

    it('finds a payment by id, by provider reference, and by company while it is open', async () => {
      const companyId = await newCompany();
      const payment = newPayment(companyId);
      payment.attachProviderRef('pi_find_me');
      await payments.insert(payment);

      expect((await payments.findById(payment.id))?.id).toBe(payment.id);
      expect((await payments.findByProviderRef('pi_find_me'))?.id).toBe(payment.id);
      expect((await payments.findLiveByCompany(companyId))?.id).toBe(payment.id);
    });

    it('returns null when nothing matches', async () => {
      expect(await payments.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
      expect(await payments.findByProviderRef('pi_nope')).toBeNull();
      expect(await payments.findLiveByCompany(await newCompany())).toBeNull();
    });

    it.each(Object.values(PaymentStatus))('reports a %s payment as the live one only if it is live (all but CANCELED)', async (status) => {
      const companyId = await newCompany();
      const payment = await stored(companyId, status);
      expect((await payments.findLiveByCompany(companyId))?.id).toBe(status === PaymentStatus.CANCELED ? undefined : payment.id);
    });

    it.each([
      ['whole yen', Money.of(4900, 'JPY')],
      ['a very large amount (beyond 32 bits: needs bigint)', Money.of(9_007_199_254_740_991, 'USD')],
      ['one cent', Money.of(1, 'EUR')],
    ])('stores %s exactly', async (_label, amount) => {
      const payment = newPayment(await newCompany(), amount);
      await payments.insert(payment);
      expect((await payments.findById(payment.id))?.amount.equals(amount)).toBe(true);
    });
  });

  describe('at most one open or succeeded payment per company (the double-charge guard)', () => {
    it('lets exactly ONE of five simultaneous "start payment" attempts win', async () => {
      const companyId = await newCompany();

      const results = await Promise.allSettled(Array.from({ length: 5 }, () => payments.insert(newPayment(companyId))));

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const loser of results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')) {
        expect(loser.reason).toBeInstanceOf(LivePaymentAlreadyExistsError);
      }
      const rows = await queryDatabase(t.databaseUrl, `SELECT 1 FROM payments WHERE company_id = '${companyId}'`);
      expect(rows).toHaveLength(1);
    });
  });

  describe('saving changes with optimistic locking', () => {
    it('persists the changes and returns the payment with the next version', async () => {
      const payment = await stored(await newCompany());
      const loaded = (await payments.findById(payment.id)) as Payment;
      loaded.attachProviderRef('pi_saved');
      loaded.applyStatus(PaymentStatus.PROCESSING);

      const saved = await payments.save(loaded);

      expect(saved.version).toBe(1);
      expect(loaded.version).toBe(0);
      expect(await payments.findById(payment.id)).toMatchObject({ status: PaymentStatus.PROCESSING, providerRef: 'pi_saved', version: 1 });
    });

    it('can keep saving through the returned payment: versions go 1, 2, 3', async () => {
      let payment = await stored(await newCompany());
      payment.applyStatus(PaymentStatus.PROCESSING);
      payment = await payments.save(payment);
      payment.applyStatus(PaymentStatus.FAILED, 'card_declined');
      payment = await payments.save(payment);
      payment.applyStatus(PaymentStatus.SUCCEEDED);
      payment = await payments.save(payment);

      expect(payment.version).toBe(3);
      expect(await payments.findById(payment.id)).toMatchObject({ status: PaymentStatus.SUCCEEDED, failureCode: null, version: 3 });
    });

    it('REFUSES a stale write instead of silently overwriting (no lost update), and lets the loser reload and retry', async () => {
      const original = await stored(await newCompany());
      const a = (await payments.findById(original.id)) as Payment;
      const b = (await payments.findById(original.id)) as Payment;
      a.applyStatus(PaymentStatus.PROCESSING);
      await payments.save(a);
      b.applyStatus(PaymentStatus.FAILED, 'late');
      await expect(payments.save(b)).rejects.toBeInstanceOf(PaymentConcurrentModificationError);
      expect(await payments.findById(original.id)).toMatchObject({ status: PaymentStatus.PROCESSING, failureCode: null, version: 1 });

      const reloaded = (await payments.findById(original.id)) as Payment;
      reloaded.applyStatus(PaymentStatus.SUCCEEDED);

      await expect(payments.save(reloaded)).resolves.toMatchObject({ version: 2 });
    });

    it('lets exactly ONE of five simultaneous saves of the same payment win', async () => {
      const original = await stored(await newCompany());
      const readers = await Promise.all(Array.from({ length: 5 }, () => payments.findById(original.id) as Promise<Payment>));
      readers.forEach((payment, index) => payment.applyStatus(PaymentStatus.FAILED, `reason_${index}`));

      const results = await Promise.allSettled(readers.map((payment) => payments.save(payment)));

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await payments.findById(original.id)).toMatchObject({ version: 1 });
    });

    it('refuses to save a payment that does not exist', async () => {
      const ghost = Payment.restore({ ...newPayment('00000000-0000-4000-8000-000000000000').toSnapshot() });
      await expect(payments.save(ghost)).rejects.toBeInstanceOf(PaymentConcurrentModificationError);
    });
  });

  describe('outbox: messages are saved in the SAME transaction as the payment change', () => {
    const message = (type = 'payment.succeeded') => ({ id: crypto.randomUUID(), type, payload: { paymentId: 'p', companyId: 'c' } });
    const outboxRows = (id: string) =>
      queryDatabase<{ type: string; payload: unknown; processed_at: Date | null; attempts: number }>(
        t.databaseUrl,
        `SELECT type, payload, processed_at, attempts FROM outbox_messages WHERE id = '${id}'`,
      );

    it('queues the message together with the change, undelivered', async () => {
      const payment = await stored(await newCompany());
      payment.applyStatus(PaymentStatus.SUCCEEDED);
      const queued = message();

      const saved = await payments.save(payment, [queued]);

      expect(saved.status).toBe(PaymentStatus.SUCCEEDED);
      expect(await outboxRows(queued.id)).toEqual([
        { type: 'payment.succeeded', payload: { paymentId: 'p', companyId: 'c' }, processed_at: null, attempts: 0 },
      ]);
    });

    it('queues NOTHING when the save loses the optimistic-lock race (no message for a change that did not happen)', async () => {
      const original = await stored(await newCompany());
      const first = (await payments.findById(original.id)) as Payment;
      const second = (await payments.findById(original.id)) as Payment;
      first.applyStatus(PaymentStatus.PROCESSING);
      await payments.save(first);

      second.applyStatus(PaymentStatus.SUCCEEDED);
      const queued = message();
      await expect(payments.save(second, [queued])).rejects.toBeInstanceOf(PaymentConcurrentModificationError);

      expect(await outboxRows(queued.id)).toHaveLength(0);
    });

    it('UNDOES the payment change when the message cannot be written: all or nothing', async () => {
      const payment = await stored(await newCompany());
      payment.applyStatus(PaymentStatus.SUCCEEDED);
      const impossible = message('x'.repeat(101));

      await expect(payments.save(payment, [impossible])).rejects.toThrow();

      expect(await payments.findById(payment.id)).toMatchObject({ status: PaymentStatus.CREATED, version: 0 });
      expect(await outboxRows(impossible.id)).toHaveLength(0);
    });

    it('queues several messages in the one transaction', async () => {
      const payment = await stored(await newCompany());
      payment.applyStatus(PaymentStatus.PROCESSING);
      const [a, b] = [message('a.event'), message('b.event')];

      await payments.save(payment, [a, b]);

      expect(await outboxRows(a.id)).toHaveLength(1);
      expect(await outboxRows(b.id)).toHaveLength(1);
    });
  });

  describe('rules enforced by the database itself', () => {
    const insert = (columns: Record<string, string | number>, companyId: string) => {
      const row = {
        id: crypto.randomUUID(),
        company_id: companyId,
        provider: 'mock',
        amount_minor: 4900,
        currency: 'USD',
        status: 'SUCCEEDED',
        ...columns,
      };
      const keys = Object.keys(row);
      return queryDatabase(
        t.databaseUrl,
        `INSERT INTO payments (${keys.join(', ')}, created_at, updated_at) VALUES (${keys.map((k) => `'${(row as Record<string, string | number>)[k]}'`).join(', ')}, now(), now())`,
      );
    };

    it.each([
      ['a zero amount', { amount_minor: 0 }, /ck_payments_amount_positive/],
      ['a negative amount', { amount_minor: -5 }, /ck_payments_amount_positive/],
      ['an unknown status', { status: 'HACKED' }, /ck_payments_status/],
      ['a lower-case currency', { currency: 'usd' }, /ck_payments_currency_upper/],
      ['a negative version', { version: -1 }, /ck_payments_version_nonnegative/],
    ])('rejects %s, whatever the code does', async (_label, columns, error) => {
      await expect(insert(columns, await newCompany())).rejects.toThrow(error);
    });

    it('rejects a payment for a company that does not exist', async () => {
      await expect(insert({}, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(/fk_payments_company/);
    });

    it('refuses to delete a company that has payments', async () => {
      const companyId = await newCompany();
      await stored(companyId, PaymentStatus.SUCCEEDED);
      await expect(queryDatabase(t.databaseUrl, `DELETE FROM companies WHERE id = '${companyId}'`)).rejects.toThrow(/fk_payments_company/);
    });

    it('never lets two payments share one provider reference (mixing two charges)', async () => {
      const a = newPayment(await newCompany());
      a.attachProviderRef('pi_shared');
      await payments.insert(a);

      const b = newPayment(await newCompany());
      b.attachProviderRef('pi_shared');
      await expect(payments.insert(b)).rejects.toThrow(/uq_payments_provider_ref/);
    });

    it('allows every company its own open payment, none linked to a provider yet (NULL references do not collide)', async () => {
      await payments.insert(newPayment(await newCompany()));
      await expect(payments.insert(newPayment(await newCompany()))).resolves.toBeUndefined();
    });
  });
});
