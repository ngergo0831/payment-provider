import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { CompanyNotFoundException, PaymentProviderUnavailableException } from '../../../common/errors/exceptions';
import { FakeCompanyGateway, FixedPricing, InMemoryPaymentRepository } from '../../../testing/in-memory-payments';
import { MockOutcome, MockPaymentProvider } from '../../infrastructure/providers/mock-payment.provider';
import { Money } from '../../domain/money';
import { PaymentStatus } from '../../domain/payment-status';
import { PaymentRecordConflictException } from '../payment-record-conflict.exception';
import { PaymentSynchronizer } from '../payment-synchronizer';
import { StartPaymentUseCase } from './start-payment.use-case';

const COMPANY = 'company-1';

function setup(pricing = new FixedPricing()) {
  const provider = new MockPaymentProvider();
  const payments = new InMemoryPaymentRepository();
  const companies = new FakeCompanyGateway();
  companies.add(COMPANY);
  const build = (withProvider = provider, withPricing = pricing) =>
    new StartPaymentUseCase(companies, withPricing, withProvider, payments, new PaymentSynchronizer(payments));
  return { provider, payments, build, useCase: build() };
}

// The everyday paths (start, resume, double click, decline, outage, self-repair) are tested over real HTTP and
// PostgreSQL in test/payments.e2e-spec.ts. These are the cases that need a fake to reach.
describe('StartPaymentUseCase', () => {
  it('charges the configured price in the configured currency (yen are whole: no hidden 100x)', async () => {
    const { useCase } = setup(new FixedPricing(Money.of(5000, 'JPY')));
    const { payment } = await useCase.execute(COMPANY);
    expect(payment.amount.toString()).toBe('5000 JPY');
  });

  it('reuses the open payment even if the price in configuration changed since (the amount is fixed at creation)', async () => {
    const { useCase, build, provider } = setup(new FixedPricing(Money.of(4900, 'USD')));
    const first = await useCase.execute(COMPANY);

    const later = await build(provider, new FixedPricing(Money.of(9900, 'USD'))).execute(COMPANY);

    expect(later.payment.id).toBe(first.payment.id);
    expect(later.payment.amount.amountMinor).toBe(4900);
  });

  it('refuses an unknown company', async () => {
    const { useCase } = setup();
    await expect(useCase.execute('nobody')).rejects.toBeInstanceOf(CompanyNotFoundException);
  });

  it('survives losing the optimistic-lock race while recording the provider state', async () => {
    const { useCase, payments } = setup();
    payments.conflictsToInject = 1;

    const { payment } = await useCase.execute(COMPANY);

    expect(payment.providerRef).toEqual(expect.any(String));
  });

  it('fails with the retryable error when resuming a known payment during an outage, changing nothing', async () => {
    const { useCase, provider, payments } = setup();
    const { payment } = await useCase.execute(COMPANY);
    provider.setOutage(true);

    await expect(useCase.execute(COMPANY)).rejects.toBeInstanceOf(PaymentProviderUnavailableException);

    expect((await payments.findById(payment.id))?.version).toBe(payment.version);
  });

  describe('after the payment succeeded but before the company is activated', () => {
    async function paidButNotYetActive() {
      const context = setup();
      const { payment } = await context.useCase.execute(COMPANY);
      context.provider.simulate(payment.providerRef as string, MockOutcome.SUCCEED);
      await context.useCase.execute(COMPANY);
      return { ...context, paid: payment };
    }

    it('does not even ask the provider again', async () => {
      const { useCase, provider } = await paidButNotYetActive();
      const retrieve = jest.spyOn(provider, 'retrievePayment');

      await useCase.execute(COMPANY);

      expect(retrieve).not.toHaveBeenCalled();
    });

    it('still converges on that payment when the insert loses to it (a racing request saw no payment yet)', async () => {
      const { useCase, payments, paid } = await paidButNotYetActive();
      const findLive = payments.findLiveByCompany.bind(payments);
      jest.spyOn(payments, 'findLiveByCompany').mockResolvedValueOnce(null).mockImplementation(findLive);

      const again = await useCase.execute(COMPANY);

      expect(again.payment.id).toBe(paid.id);
      expect(payments.count).toBe(1);
    });
  });

  it('never hands out a client secret for a FINAL payment, even if a misbehaving provider still sends one', async () => {
    const { useCase, provider } = setup();
    const { payment } = await useCase.execute(COMPANY);
    provider.simulate(payment.providerRef as string, MockOutcome.SUCCEED);
    const real = provider.retrievePayment.bind(provider);
    jest.spyOn(provider, 'retrievePayment').mockImplementation(async (ref) => ({ ...(await real(ref)), clientSecret: 'leaked_secret' }));

    const resumed = await useCase.execute(COMPANY);

    expect(resumed.payment.status).toBe(PaymentStatus.SUCCEEDED);
    expect(resumed.clientSecret).toBeNull();
  });

  it('refuses to close a PROCESSING payment blindly when the provider no longer knows it (money may be in flight)', async () => {
    const { useCase, provider, payments, build } = setup();
    const { payment } = await useCase.execute(COMPANY);
    provider.simulate(payment.providerRef as string, MockOutcome.PROCESSING);
    await useCase.execute(COMPANY);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(build(new MockPaymentProvider()).execute(COMPANY)).rejects.toBeInstanceOf(PaymentRecordConflictException);
    expect(payments.count).toBe(1);
  });
});
