import { MOCK_WEBHOOK_SIGNATURE, MockOutcome, MockPaymentProvider } from './mock-payment.provider';
import { Money } from '../../domain/money';
import { PaymentStatus } from '../../domain/payment-status';
import { describePaymentProviderContract } from '../../../testing/payment-provider.contract';

describePaymentProviderContract('MockPaymentProvider', () => {
  const provider = new MockPaymentProvider();
  return {
    provider,
    outage: { start: () => provider.setOutage(true), stop: () => provider.setOutage(false) },
    drive: (providerRef, outcome) => void provider.simulate(providerRef, outcome as MockOutcome),
    signedWebhook: (providerRef, paymentId) => provider.signedWebhook(providerRef, paymentId),
    invalidSignature: 'not-the-signature',
    ignoredWebhook: () => ({ rawBody: Buffer.from(JSON.stringify({ type: 'something.else' })), signature: MOCK_WEBHOOK_SIGNATURE }),
  };
});

describe('MockPaymentProvider controls', () => {
  const request = (paymentId = 'p-1') => ({ paymentId, companyId: 'c-1', amount: Money.of(4900, 'USD') });

  it('simulate() returns the notification the provider would send, naming the payment and our id', async () => {
    const provider = new MockPaymentProvider();
    const { providerRef } = await provider.createPayment(request('our-payment-id'));

    const event = provider.simulate(providerRef, MockOutcome.SUCCEED);

    expect(event).toMatchObject({ providerRef, paymentId: 'our-payment-id', type: 'mock.payment.succeed' });
    expect(event.id).toMatch(/^evt_mock_/);
  });

  it('gives every notification a unique id, as a real provider does', async () => {
    const provider = new MockPaymentProvider();
    const { providerRef } = await provider.createPayment(request());
    const ids = [MockOutcome.PROCESSING, MockOutcome.DECLINE, MockOutcome.SUCCEED].map((o) => provider.simulate(providerRef, o).id);
    expect(new Set(ids).size).toBe(3);
  });

  it('simulating an outcome on a FINAL payment is a no-op notification and changes nothing', async () => {
    const provider = new MockPaymentProvider();
    const { providerRef } = await provider.createPayment(request());
    provider.simulate(providerRef, MockOutcome.SUCCEED);

    const event = provider.simulate(providerRef, MockOutcome.DECLINE);

    expect(event.type).toBe('mock.payment.noop');
    expect((await provider.retrievePayment(providerRef)).status).toBe(PaymentStatus.SUCCEEDED);
  });

  it('a "lost webhook" is simply a state change nobody was told about: retrieval still sees it', async () => {
    const provider = new MockPaymentProvider();
    const { providerRef } = await provider.createPayment(request());

    provider.simulate(providerRef, MockOutcome.SUCCEED);

    expect((await provider.retrievePayment(providerRef)).status).toBe(PaymentStatus.SUCCEEDED);
  });

  it('is isolated: separate instances share nothing', async () => {
    const a = new MockPaymentProvider();
    const b = new MockPaymentProvider();
    const { providerRef } = await a.createPayment(request());
    await expect(b.retrievePayment(providerRef)).rejects.toThrow();
  });

  it('reports whether an outage is on', () => {
    const provider = new MockPaymentProvider();
    expect(provider.isOutage()).toBe(false);
    provider.setOutage(true);
    expect(provider.isOutage()).toBe(true);
  });

  it('webhook parsing: an unparseable body with a valid signature is ignored, not a crash', () => {
    const provider = new MockPaymentProvider();
    expect(provider.parseWebhook(Buffer.from('not json {'), MOCK_WEBHOOK_SIGNATURE)).toBeNull();
  });
});
