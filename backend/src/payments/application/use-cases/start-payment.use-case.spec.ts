import { CompanyAlreadyActiveException, CompanyNotFoundException, PaymentProviderUnavailableException } from '../../../common/errors/exceptions';
import { jest } from '@jest/globals';
import { FakeCompanyGateway, FixedPricing, InMemoryPaymentRepository } from '../../../testing/in-memory-payments';
import { MockOutcome, MockPaymentProvider } from '../../infrastructure/providers/mock-payment.provider';
import { Money } from '../../domain/money';
import { PaymentStatus } from '../../domain/payment-status';
import { PaymentSynchronizer } from '../payment-synchronizer';
import { StartPaymentUseCase } from './start-payment.use-case';

const COMPANY = 'company-1';

function setup(pricing = new FixedPricing()) {
  const provider = new MockPaymentProvider();
  const payments = new InMemoryPaymentRepository();
  const companies = new FakeCompanyGateway();
  companies.add(COMPANY);
  const useCase = new StartPaymentUseCase(companies, pricing, provider, payments, new PaymentSynchronizer(payments));
  return { provider, payments, companies, useCase };
}

describe('StartPaymentUseCase', () => {
  it('creates a payment for the plan price, links it to the provider, and returns the client secret', async () => {
    const { useCase } = setup();

    const { payment, clientSecret } = await useCase.execute(COMPANY);

    expect(payment).toMatchObject({ companyId: COMPANY, status: PaymentStatus.CREATED, provider: 'mock' });
    expect(payment.amount.equals(Money.of(4900, 'USD'))).toBe(true);
    expect(payment.providerRef).toMatch(/^mock_pi_/);
    expect(clientSecret).toEqual(expect.any(String));
  });

  it('charges the configured price in the configured currency (yen are whole: no hidden 100x)', async () => {
    const { useCase } = setup(new FixedPricing(Money.of(5000, 'JPY')));
    const { payment } = await useCase.execute(COMPANY);
    expect(payment.amount.toString()).toBe('5000 JPY');
  });

  describe('is safe to call again and again (start OR resume)', () => {
    it('a double click returns the SAME payment and secret, and the provider is asked to create only once', async () => {
      const { useCase, provider, payments } = setup();
      const create = jest.spyOn(provider, 'createPayment');

      const first = await useCase.execute(COMPANY);
      const second = await useCase.execute(COMPANY);

      expect(second.payment.id).toBe(first.payment.id);
      expect(second.clientSecret).toBe(first.clientSecret);
      expect(create).toHaveBeenCalledTimes(1);
      expect(payments.count).toBe(1);
    });

    it('simultaneous requests still produce ONE payment and ONE provider payment', async () => {
      const { useCase, payments } = setup();

      const results = await Promise.all(Array.from({ length: 5 }, () => useCase.execute(COMPANY)));

      expect(payments.count).toBe(1);
      expect(new Set(results.map((r) => r.payment.id)).size).toBe(1);
      expect(new Set(results.map((r) => r.payment.providerRef)).size).toBe(1);
    });

    it('survives losing the optimistic-lock race while recording the provider state', async () => {
      const { useCase, payments } = setup();
      payments.conflictsToInject = 1;

      const { payment } = await useCase.execute(COMPANY);

      expect(payment.providerRef).toEqual(expect.any(String));
    });
  });

  describe('refuses when there is nothing to pay', () => {
    it('for an unknown company', async () => {
      const { useCase } = setup();
      await expect(useCase.execute('nobody')).rejects.toBeInstanceOf(CompanyNotFoundException);
    });

    it('for an already active company, and creates nothing (no second charge)', async () => {
      const { useCase, companies, payments } = setup();
      companies.add(COMPANY, true);

      await expect(useCase.execute(COMPANY)).rejects.toBeInstanceOf(CompanyAlreadyActiveException);
      expect(payments.count).toBe(0);
    });
  });

  describe('when the provider is down', () => {
    it('fails with the retryable error but KEEPS our intent, so nothing is lost', async () => {
      const { useCase, provider, payments } = setup();
      provider.setOutage(true);

      await expect(useCase.execute(COMPANY)).rejects.toBeInstanceOf(PaymentProviderUnavailableException);

      const [orphan] = payments.all();
      expect(orphan).toMatchObject({ status: PaymentStatus.CREATED, providerRef: null });
    });

    it('recovers on the next call by resuming THAT payment, with no duplicates', async () => {
      const { useCase, provider, payments } = setup();
      provider.setOutage(true);
      await expect(useCase.execute(COMPANY)).rejects.toThrow();
      const [orphan] = payments.all();
      provider.setOutage(false);

      const { payment, clientSecret } = await useCase.execute(COMPANY);

      expect(payments.count).toBe(1);
      expect(payment.id).toBe(orphan.id);
      expect(payment.providerRef).toEqual(expect.any(String));
      expect(clientSecret).toEqual(expect.any(String));
    });

    it('fails with the retryable error when resuming a known payment during an outage, changing nothing', async () => {
      const { useCase, provider, payments } = setup();
      const { payment } = await useCase.execute(COMPANY);
      provider.setOutage(true);

      await expect(useCase.execute(COMPANY)).rejects.toBeInstanceOf(PaymentProviderUnavailableException);

      expect((await payments.findById(payment.id))?.version).toBe(payment.version);
    });
  });

  describe('after a declined card', () => {
    it('reports FAILED with the reason, on the SAME payment, and hands back the secret so another card can be tried', async () => {
      const { useCase, provider } = setup();
      const first = await useCase.execute(COMPANY);
      provider.simulate(first.payment.providerRef as string, MockOutcome.DECLINE);

      const retry = await useCase.execute(COMPANY);

      expect(retry.payment.id).toBe(first.payment.id);
      expect(retry.payment).toMatchObject({ status: PaymentStatus.FAILED, failureCode: 'card_declined' });
      expect(retry.clientSecret).toEqual(expect.any(String));
    });

    it('moves on to SUCCEEDED when the retry works, clearing the failure', async () => {
      const { useCase, provider } = setup();
      const { payment } = await useCase.execute(COMPANY);
      provider.simulate(payment.providerRef as string, MockOutcome.DECLINE);
      await useCase.execute(COMPANY);
      provider.simulate(payment.providerRef as string, MockOutcome.SUCCEED);

      const after = await useCase.execute(COMPANY);

      expect(after.payment).toMatchObject({ status: PaymentStatus.SUCCEEDED, failureCode: null });
    });
  });

  describe('self-repair', () => {
    it('a payment that succeeded at the provider with NO webhook is discovered on resume: SUCCEEDED, nothing left to collect', async () => {
      const { useCase, provider } = setup();
      const { payment } = await useCase.execute(COMPANY);
      provider.simulate(payment.providerRef as string, MockOutcome.SUCCEED); // the notification never arrives

      const resumed = await useCase.execute(COMPANY);

      expect(resumed.payment.status).toBe(PaymentStatus.SUCCEEDED);
      expect(resumed.clientSecret).toBeNull();
    });

    it('never hands out a client secret for a FINAL payment, even if a misbehaving provider still sends one', async () => {
      const { useCase, provider } = setup();
      const { payment } = await useCase.execute(COMPANY);
      provider.simulate(payment.providerRef as string, MockOutcome.SUCCEED);
      const real = provider.retrievePayment.bind(provider);
      jest.spyOn(provider, 'retrievePayment').mockImplementation(async (ref) => ({ ...(await real(ref)), clientSecret: 'leaked_secret' }));

      const resumed = await useCase.execute(COMPANY);

      expect(resumed.payment.status).toBe(PaymentStatus.SUCCEEDED);
      expect(resumed.clientSecret).toBeNull(); // our own rule, independent of the provider's good behaviour
    });

    it('a payment the provider canceled (e.g. it expired) is replaced by a FRESH one, not handed back dead', async () => {
      const { useCase, provider, payments } = setup();
      const first = await useCase.execute(COMPANY);
      provider.simulate(first.payment.providerRef as string, MockOutcome.CANCEL);

      const second = await useCase.execute(COMPANY);

      expect(second.payment.id).not.toBe(first.payment.id);
      expect(second.payment.status).toBe(PaymentStatus.CREATED);
      expect(second.clientSecret).toEqual(expect.any(String));
      expect(payments.count).toBe(2);
      expect((await payments.findById(first.payment.id))?.status).toBe(PaymentStatus.CANCELED);
    });
  });

  it('reuses the open payment even if the price in configuration changed since (the amount is fixed at creation)', async () => {
    const payments = new InMemoryPaymentRepository();
    const provider = new MockPaymentProvider();
    const companies = new FakeCompanyGateway();
    companies.add(COMPANY);
    const sync = new PaymentSynchronizer(payments);
    const first = await new StartPaymentUseCase(companies, new FixedPricing(Money.of(4900, 'USD')), provider, payments, sync).execute(COMPANY);

    const later = await new StartPaymentUseCase(companies, new FixedPricing(Money.of(9900, 'USD')), provider, payments, sync).execute(COMPANY);

    expect(later.payment.id).toBe(first.payment.id);
    expect(later.payment.amount.amountMinor).toBe(4900);
  });
});
