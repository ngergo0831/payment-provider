import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { FakeCompanyGateway, FixedPricing, InMemoryPaymentRepository } from '../../../testing/in-memory-payments';
import { MockOutcome, MockPaymentProvider } from '../../infrastructure/providers/mock-payment.provider';
import { Money } from '../../domain/money';
import { Payment } from '../../domain/payment';
import { PaymentStatus } from '../../domain/payment-status';
import { PaymentSynchronizer } from '../payment-synchronizer';
import { ReconcilePaymentsUseCase } from './reconcile-payments.use-case';
import { StartPaymentUseCase } from './start-payment.use-case';

const minutes = (n: number) => n * 60_000;
const later = (ms: number) => new Date(Date.now() + ms);

function setup() {
  const provider = new MockPaymentProvider();
  const payments = new InMemoryPaymentRepository();
  const companies = new FakeCompanyGateway();
  const synchronizer = new PaymentSynchronizer(payments);
  const start = new StartPaymentUseCase(companies, new FixedPricing(), provider, payments, synchronizer);
  const reconcile = new ReconcilePaymentsUseCase(provider, payments, synchronizer);
  /** A company that has started paying: its payment exists at the provider and is linked. */
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
    const { provider, payments, reconcile, payer } = await setup();
    const payment = await payer('c1');
    provider.simulate(payment.providerRef as string, MockOutcome.SUCCEED); // the notification was lost

    const report = await reconcile.execute(later(minutes(5)));

    expect(report).toEqual({ checked: 1, failed: 0 });
    expect((await payments.findById(payment.id))?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(payments.outbox).toHaveLength(1);
  });

  it('also notices a failure the provider reported (an open FAILED payment is still being watched)', async () => {
    const { provider, payments, reconcile, payer } = await setup();
    const payment = await payer('c1');
    provider.simulate(payment.providerRef as string, MockOutcome.DECLINE);

    await reconcile.execute(later(minutes(5)));

    expect(await payments.findById(payment.id)).toMatchObject({ status: PaymentStatus.FAILED, failureCode: 'card_declined' });
  });

  describe('what it leaves alone', () => {
    it('payments checked recently: the webhook gets time to arrive first', async () => {
      const { reconcile, payer } = await setup();
      await payer('c1');
      expect(await reconcile.execute(later(minutes(1)))).toEqual({ checked: 0, failed: 0 });
    });

    it('abandoned checkouts older than a day: it stops asking the provider about them', async () => {
      const { reconcile, payer } = await setup();
      await payer('c1');
      expect(await reconcile.execute(later(minutes(25 * 60)))).toEqual({ checked: 0, failed: 0 });
    });

    it('payments that are already final', async () => {
      const { provider, reconcile, payer } = await setup();
      const payment = await payer('c1');
      provider.simulate(payment.providerRef as string, MockOutcome.SUCCEED);
      await reconcile.execute(later(minutes(5))); // becomes SUCCEEDED

      expect(await reconcile.execute(later(minutes(10)))).toEqual({ checked: 0, failed: 0 });
    });

    it('payments the provider has not heard of yet (no reference): resuming checkout handles those', async () => {
      const { payments, reconcile } = await setup();
      await payments.insert(Payment.start({ companyId: 'c9', provider: 'mock', amount: Money.of(4900, 'USD') }));
      expect(await reconcile.execute(later(minutes(5)))).toEqual({ checked: 0, failed: 0 });
    });

    it('a payment it just checked: not asked again until it has been quiet for a while again', async () => {
      const { provider, reconcile, payer } = await setup();
      const payment = await payer('c1');
      provider.simulate(payment.providerRef as string, MockOutcome.PROCESSING);

      expect((await reconcile.execute(later(minutes(5)))).checked).toBe(1);
      expect((await reconcile.execute(later(minutes(5) + 30_000))).checked).toBe(0); // checked 30 s ago
      expect((await reconcile.execute(later(minutes(8)))).checked).toBe(1); // quiet again
    });
  });

  describe('resilience', () => {
    it('one payment failing does not stop the others', async () => {
      const { provider, payments, reconcile, payer } = await setup();
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
      const { provider, payments, reconcile, payer } = await setup();
      const payment = await payer('c1');
      provider.simulate(payment.providerRef as string, MockOutcome.SUCCEED);
      provider.setOutage(true);

      expect(await reconcile.execute(later(minutes(5)))).toEqual({ checked: 1, failed: 1 });
      expect((await payments.findById(payment.id))?.status).toBe(PaymentStatus.CREATED);

      provider.setOutage(false);
      expect(await reconcile.execute(later(minutes(6)))).toEqual({ checked: 1, failed: 0 });
      expect((await payments.findById(payment.id))?.status).toBe(PaymentStatus.SUCCEEDED);
    });

    it('does nothing, harmlessly, when there is nothing to do', async () => {
      const { reconcile } = await setup();
      expect(await reconcile.execute()).toEqual({ checked: 0, failed: 0 });
    });
  });
});
