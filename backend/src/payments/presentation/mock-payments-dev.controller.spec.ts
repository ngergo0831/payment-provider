import { HandleProviderEventUseCase } from '../application/use-cases/handle-provider-event.use-case';
import { StripePaymentProvider } from '../infrastructure/providers/stripe-payment.provider';
import { MockPaymentsDevController } from './mock-payments-dev.controller';

describe('MockPaymentsDevController', () => {
  it('refuses to be created with the real provider, so a wiring mistake fails at startup', () => {
    const stripe = new StripePaymentProvider({ secretKey: 'sk_test_x', webhookSecret: 'whsec_x' });
    expect(() => new MockPaymentsDevController(stripe, {} as HandleProviderEventUseCase)).toThrow(/need the mock payment provider/);
  });
});
