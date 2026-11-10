import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { InMemoryPaymentRepository } from '../../../testing/in-memory-payments';
import { MockOutcome, MockPaymentProvider } from '../../infrastructure/providers/mock-payment.provider';
import { Money } from '../../domain/money';
import { Payment } from '../../domain/payment';
import { PaymentStatus } from '../../domain/payment-status';
import { PaymentSynchronizer } from '../payment-synchronizer';
import { ProviderEvent, ProviderPaymentNotFoundError } from '../ports/payment-provider';
import { EventHandlingResult, HandleProviderEventUseCase } from './handle-provider-event.use-case';

const COMPANY = 'company-1';

/** A stored payment the provider knows about; `linked: false` models a crash before its reference was stored. */
async function setup({ linked = true } = {}) {
  const provider = new MockPaymentProvider();
  const payments = new InMemoryPaymentRepository();
  const handle = new HandleProviderEventUseCase(provider, payments, new PaymentSynchronizer(payments));
  const payment = Payment.start({ companyId: COMPANY, provider: 'mock', amount: Money.of(4900, 'USD') });
  const { providerRef } = await provider.createPayment({ paymentId: payment.id, companyId: COMPANY, amount: payment.amount });
  if (linked) payment.attachProviderRef(providerRef);
  await payments.insert(payment);
  return { provider, payments, handle, payment, providerRef };
}

// Delivery, redelivery, simultaneous deliveries, conflicts and retries after an outage are tested over real HTTP
// and PostgreSQL in test/webhooks.e2e-spec.ts. These are the cases that need a hand-made event to reach.
describe('HandleProviderEventUseCase', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('an event that CLAIMS success changes nothing if the provider does not agree (a forged or confused message)', async () => {
    const { payments, handle, payment, providerRef } = await setup();
    const claim: ProviderEvent = { id: 'evt_lying', type: 'mock.payment.succeed', providerRef, paymentId: payment.id };

    await handle.execute(claim);

    expect((await payments.findById(payment.id))?.status).toBe(PaymentStatus.CREATED);
    expect(payments.outbox).toEqual([]);
  });

  describe('events about payments we do not know', () => {
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

  it('repairs a lost link: a payment whose provider reference was never stored is found through our id', async () => {
    const { provider, payments, handle, payment, providerRef } = await setup({ linked: false });
    const event = provider.simulate(providerRef, MockOutcome.SUCCEED);

    expect(await handle.execute(event)).toBe(EventHandlingResult.PROCESSED);

    expect(await payments.findById(payment.id)).toMatchObject({ providerRef, status: PaymentStatus.SUCCEEDED });
  });
});
