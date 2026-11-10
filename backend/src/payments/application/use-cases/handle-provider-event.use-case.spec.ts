import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { PaymentProviderUnavailableException } from '../../../common/errors/exceptions';
import { FakeCompanyGateway, FixedPricing, InMemoryPaymentRepository } from '../../../testing/in-memory-payments';
import { MockOutcome, MockPaymentProvider } from '../../infrastructure/providers/mock-payment.provider';
import { Money } from '../../domain/money';
import { Payment } from '../../domain/payment';
import { PaymentStatus } from '../../domain/payment-status';
import { PaymentSynchronizer } from '../payment-synchronizer';
import { ProviderEvent, ProviderPaymentNotFoundError } from '../ports/payment-provider';
import { EventHandlingResult, HandleProviderEventUseCase } from './handle-provider-event.use-case';
import { StartPaymentUseCase } from './start-payment.use-case';

const COMPANY = 'company-1';

async function setup() {
  const provider = new MockPaymentProvider();
  const payments = new InMemoryPaymentRepository();
  const companies = new FakeCompanyGateway();
  companies.add(COMPANY);
  const synchronizer = new PaymentSynchronizer(payments);
  const start = new StartPaymentUseCase(companies, new FixedPricing(), provider, payments, synchronizer);
  const handle = new HandleProviderEventUseCase(provider, payments, synchronizer);
  const { payment } = await start.execute(COMPANY);
  return { provider, payments, handle, payment, providerRef: payment.providerRef as string };
}

describe('HandleProviderEventUseCase', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("applies the provider's current state to the payment", async () => {
    const { provider, payments, handle, payment, providerRef } = await setup();
    const event = provider.simulate(providerRef, MockOutcome.SUCCEED);

    expect(await handle.execute(event)).toBe(EventHandlingResult.PROCESSED);

    expect((await payments.findById(payment.id))?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(payments.outbox).toHaveLength(1);
  });

  describe('duplicates', () => {
    it('handles a redelivered event again, harmlessly: the payment is already up to date', async () => {
      const { provider, payments, handle, payment, providerRef } = await setup();
      const event = provider.simulate(providerRef, MockOutcome.SUCCEED);
      await handle.execute(event);

      expect(await handle.execute(event)).toBe(EventHandlingResult.PROCESSED);

      expect((await payments.findById(payment.id))?.status).toBe(PaymentStatus.SUCCEEDED);
    });

    it('queues ONE "payment succeeded" message however many times the provider repeats the event', async () => {
      const { provider, payments, handle, providerRef } = await setup();
      const event = provider.simulate(providerRef, MockOutcome.SUCCEED);

      await Promise.all([handle.execute(event), handle.execute(event), handle.execute(event)]);
      await handle.execute(event);

      expect(payments.outbox).toHaveLength(1);
    });
  });

  describe("the event is only a trigger: the provider's state is what counts", () => {
    it('a stale "declined" event arriving after the success cannot undo it', async () => {
      const { provider, payments, handle, payment, providerRef } = await setup();
      const staleDecline = provider.simulate(providerRef, MockOutcome.DECLINE);
      const success = provider.simulate(providerRef, MockOutcome.SUCCEED);
      await handle.execute(success);

      await handle.execute(staleDecline);

      expect((await payments.findById(payment.id))?.status).toBe(PaymentStatus.SUCCEEDED);
    });

    it('an event that CLAIMS success changes nothing if the provider does not agree (a forged or confused message)', async () => {
      const { payments, handle, payment, providerRef } = await setup();
      const claim: ProviderEvent = {
        id: 'evt_lying',
        type: 'mock.payment.succeed',
        providerRef,
        paymentId: payment.id,
      };

      await handle.execute(claim);

      expect((await payments.findById(payment.id))?.status).toBe(PaymentStatus.CREATED);
      expect(payments.outbox).toEqual([]);
    });
  });

  describe('events about payments we do not know', () => {
    it('are acknowledged, so the provider stops retrying', async () => {
      const { handle } = await setup();
      const stranger: ProviderEvent = { id: 'evt_x', type: 'x', providerRef: 'pi_other_product', paymentId: null };

      expect(await handle.execute(stranger)).toBe(EventHandlingResult.UNKNOWN_PAYMENT);
    });

    it('include payments the provider itself no longer has (acknowledged, not retried forever)', async () => {
      const { provider, handle, providerRef } = await setup();
      const event = provider.simulate(providerRef, MockOutcome.SUCCEED);
      jest.spyOn(provider, 'retrievePayment').mockRejectedValue(new ProviderPaymentNotFoundError(providerRef));

      expect(await handle.execute(event)).toBe(EventHandlingResult.UNKNOWN_PAYMENT);
    });

    it('are not matched through a payment id that already belongs to a DIFFERENT provider payment', async () => {
      const { handle, payment } = await setup();
      const mismatched: ProviderEvent = { id: 'evt_y', type: 'x', providerRef: 'pi_someone_else', paymentId: payment.id };

      expect(await handle.execute(mismatched)).toBe(EventHandlingResult.UNKNOWN_PAYMENT);
    });
  });

  describe('repairing a lost link', () => {
    it('finds a payment whose provider reference was never stored (we crashed after the provider created it) via our id', async () => {
      const provider = new MockPaymentProvider();
      const payments = new InMemoryPaymentRepository();
      const synchronizer = new PaymentSynchronizer(payments);
      const handle = new HandleProviderEventUseCase(provider, payments, synchronizer);
      const unlinked = Payment.start({ companyId: COMPANY, provider: 'mock', amount: Money.of(4900, 'USD') });
      await payments.insert(unlinked);
      const remote = await provider.createPayment({ paymentId: unlinked.id, companyId: COMPANY, amount: unlinked.amount });
      const event = provider.simulate(remote.providerRef, MockOutcome.SUCCEED);

      expect(await handle.execute(event)).toBe(EventHandlingResult.PROCESSED);

      expect(await payments.findById(unlinked.id)).toMatchObject({ providerRef: remote.providerRef, status: PaymentStatus.SUCCEEDED });
    });
  });

  describe("when our record and the provider's disagree (a retry cannot fix it)", () => {
    it('acknowledges the event as a CONFLICT and changes nothing, so the provider stops redelivering it', async () => {
      const { provider, payments, handle, payment, providerRef } = await setup();
      const event = provider.simulate(providerRef, MockOutcome.SUCCEED);
      const real = provider.retrievePayment.bind(provider);
      jest.spyOn(provider, 'retrievePayment').mockImplementation(async (ref) => ({ ...(await real(ref)), amount: Money.of(1, 'USD') }));
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      expect(await handle.execute(event)).toBe(EventHandlingResult.CONFLICT);

      expect((await payments.findById(payment.id))?.status).toBe(PaymentStatus.CREATED);
      expect(payments.outbox).toEqual([]);
    });
  });

  describe('when handling fails part-way', () => {
    it('fails, so the provider retries the delivery, and the retry is handled', async () => {
      const { provider, payments, handle, payment, providerRef } = await setup();
      const event = provider.simulate(providerRef, MockOutcome.SUCCEED);
      provider.setOutage(true);

      await expect(handle.execute(event)).rejects.toBeInstanceOf(PaymentProviderUnavailableException);
      expect((await payments.findById(payment.id))?.status).toBe(PaymentStatus.CREATED);

      provider.setOutage(false);
      expect(await handle.execute(event)).toBe(EventHandlingResult.PROCESSED);
      expect((await payments.findById(payment.id))?.status).toBe(PaymentStatus.SUCCEEDED);
    });
  });
});
