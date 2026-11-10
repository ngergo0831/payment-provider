import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { FakeCompanyGateway, FixedPricing, InMemoryPaymentRepository } from '../../../testing/in-memory-payments';
import { MockOutcome, MockPaymentProvider } from '../../infrastructure/providers/mock-payment.provider';
import { Money } from '../../domain/money';
import { Payment } from '../../domain/payment';
import { PaymentStatus } from '../../domain/payment-status';
import { PaymentSynchronizer } from '../payment-synchronizer';
import { ProviderPaymentNotFoundError } from '../ports/payment-provider';
import { ReconcilePaymentsUseCase } from './reconcile-payments.use-case';
import { StartPaymentUseCase } from './start-payment.use-case';

const minutes = (n: number) => n * 60_000;
const days = (n: number) => n * 24 * 60 * 60_000;
const later = (ms: number) => new Date(Date.now() + ms);

function setup() {
  const provider = new MockPaymentProvider();
  const payments = new InMemoryPaymentRepository();
  const companies = new FakeCompanyGateway();
  const synchronizer = new PaymentSynchronizer(payments);
  const start = new StartPaymentUseCase(companies, new FixedPricing(), provider, payments, synchronizer);
  const reconcile = new ReconcilePaymentsUseCase(provider, payments, synchronizer);
  const payer = async (companyId: string) => {
    companies.add(companyId);
    return (await start.execute(companyId)).payment;
  };
  return { provider, payments, reconcile, payer };
}

describe('ReconcilePaymentsUseCase', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('completes a payment whose webhook never arrived, and queues the "payment succeeded" message', async () => {
    const { provider, payments, reconcile, payer } = setup();
    const payment = await payer('c1');
    provider.simulate(payment.providerRef as string, MockOutcome.SUCCEED);

    const report = await reconcile.execute(later(minutes(5)));

    expect(report).toEqual({ checked: 1, failed: 0 });
    expect((await payments.findById(payment.id))?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(payments.outbox).toHaveLength(1);
  });

  it('also notices a failure the provider reported (an open FAILED payment is still being watched)', async () => {
    const { provider, payments, reconcile, payer } = setup();
    const payment = await payer('c1');
    provider.simulate(payment.providerRef as string, MockOutcome.DECLINE);

    await reconcile.execute(later(minutes(5)));

    expect(await payments.findById(payment.id)).toMatchObject({ status: PaymentStatus.FAILED, failureCode: 'card_declined' });
  });

  describe('what it leaves alone', () => {
    it('payments checked recently: the webhook gets time to arrive first', async () => {
      const { reconcile, payer } = setup();
      await payer('c1');
      expect(await reconcile.execute(later(minutes(1)))).toEqual({ checked: 0, failed: 0 });
    });

    it('abandoned checkouts older than 30 days: it stops asking the provider about them', async () => {
      const { reconcile, payer } = setup();
      await payer('c1');
      expect(await reconcile.execute(later(days(31)))).toEqual({ checked: 0, failed: 0 });
    });

    it('payments that are already final', async () => {
      const { provider, reconcile, payer } = setup();
      const payment = await payer('c1');
      provider.simulate(payment.providerRef as string, MockOutcome.SUCCEED);
      await reconcile.execute(later(minutes(5)));

      expect(await reconcile.execute(later(minutes(10)))).toEqual({ checked: 0, failed: 0 });
    });

    it('payments the provider has not heard of yet (no reference): resuming checkout handles those', async () => {
      const { payments, reconcile } = setup();
      await payments.insert(Payment.start({ companyId: 'c9', provider: 'mock', amount: Money.of(4900, 'USD') }));
      expect(await reconcile.execute(later(minutes(5)))).toEqual({ checked: 0, failed: 0 });
    });

    it('payments made with a provider that is no longer configured', async () => {
      const { payments, reconcile } = setup();
      const other = Payment.start({ companyId: 'c9', provider: 'stripe', amount: Money.of(4900, 'USD') });
      other.attachProviderRef('pi_elsewhere');
      await payments.insert(other);
      expect(await reconcile.execute(later(minutes(5)))).toEqual({ checked: 0, failed: 0 });
    });

    it('a payment it just checked: not asked again until it has been quiet for a while again', async () => {
      const { provider, reconcile, payer } = setup();
      const payment = await payer('c1');
      provider.simulate(payment.providerRef as string, MockOutcome.PROCESSING);

      expect((await reconcile.execute(later(minutes(5)))).checked).toBe(1);
      expect((await reconcile.execute(later(minutes(5) + 30_000))).checked).toBe(0);
      expect((await reconcile.execute(later(minutes(8)))).checked).toBe(1);
    });

    it('an old payment, more and more rarely: a 10-day-old PROCESSING debit is checked about once a day', async () => {
      const { provider, reconcile, payer } = setup();
      const payment = await payer('c1');
      provider.simulate(payment.providerRef as string, MockOutcome.PROCESSING);

      expect((await reconcile.execute(later(days(10)))).checked).toBe(1);
      expect((await reconcile.execute(later(days(11)))).checked).toBe(0);
      expect((await reconcile.execute(later(days(11.2)))).checked).toBe(1);
    });
  });

  describe('resilience', () => {
    it('one payment failing does not stop the others', async () => {
      const { provider, payments, reconcile, payer } = setup();
      const broken = await payer('c1');
      const healthy = await payer('c2');
      provider.simulate(healthy.providerRef as string, MockOutcome.SUCCEED);
      const real = provider.retrievePayment.bind(provider);
      jest.spyOn(provider, 'retrievePayment').mockImplementation(async (ref) => {
        if (ref === broken.providerRef) throw new Error('boom');
        return real(ref);
      });

      const report = await reconcile.execute(later(minutes(5)));

      expect(report).toEqual({ checked: 2, failed: 1 });
      expect((await payments.findById(healthy.id))?.status).toBe(PaymentStatus.SUCCEEDED);
    });

    it('survives a provider outage: reports the failures, changes nothing, and catches up on the next run', async () => {
      const { provider, payments, reconcile, payer } = setup();
      const payment = await payer('c1');
      provider.simulate(payment.providerRef as string, MockOutcome.SUCCEED);
      provider.setOutage(true);

      expect(await reconcile.execute(later(minutes(5)))).toEqual({ checked: 1, failed: 1 });
      expect((await payments.findById(payment.id))?.status).toBe(PaymentStatus.CREATED);

      provider.setOutage(false);
      expect(await reconcile.execute(later(minutes(6)))).toEqual({ checked: 1, failed: 0 });
      expect((await payments.findById(payment.id))?.status).toBe(PaymentStatus.SUCCEEDED);
    });

    it('closes a payment the provider has no record of, so it stops being polled', async () => {
      const { provider, payments, reconcile, payer } = setup();
      const payment = await payer('c1');
      jest.spyOn(provider, 'retrievePayment').mockRejectedValue(new ProviderPaymentNotFoundError(payment.providerRef as string));

      expect(await reconcile.execute(later(minutes(5)))).toEqual({ checked: 1, failed: 0 });
      expect((await payments.findById(payment.id))?.status).toBe(PaymentStatus.CANCELED);
      expect(await reconcile.execute(later(minutes(10)))).toEqual({ checked: 0, failed: 0 });
    });

    it('does nothing, harmlessly, when there is nothing to do', async () => {
      const { reconcile } = setup();
      expect(await reconcile.execute()).toEqual({ checked: 0, failed: 0 });
    });
  });
});
