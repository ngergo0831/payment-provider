import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from '../../config/env.validation';
import { PaymentProvider } from '../application/ports/payment-provider';
import { HandleProviderEventUseCase } from '../application/use-cases/handle-provider-event.use-case';
import { MockPaymentProvider } from '../infrastructure/providers/mock-payment.provider';
import { StripePaymentProvider } from '../infrastructure/providers/stripe-payment.provider';
import { MockPaymentsDevController } from './mock-payments-dev.controller';

/**
 * The app refuses to START in production with the mock, so this controller should never be reachable there. These tests
 * pin its OWN guard anyway: a second line of defence that does not depend on the startup check staying in place.
 */
const controllerFor = (provider: PaymentProvider, nodeEnv: Environment) => {
  const config = { get: () => nodeEnv } as unknown as ConfigService<never, true>;
  return new MockPaymentsDevController(provider, {} as HandleProviderEventUseCase, config as never);
};

describe('MockPaymentsDevController guard', () => {
  it('works with the mock outside production', () => {
    const controller = controllerFor(new MockPaymentProvider(), Environment.Development);
    expect(controller.setOutage({ enabled: true })).toEqual({ outage: true });
  });

  it('answers 404 in production, even if somebody got the mock running there', () => {
    const controller = controllerFor(new MockPaymentProvider(), Environment.Production);
    expect(() => controller.setOutage({ enabled: true })).toThrow(NotFoundException);
  });

  it('answers 404 when the real provider is in use', () => {
    const stripe = new StripePaymentProvider({ secretKey: 'sk_test_x', webhookSecret: 'whsec_x' });
    const controller = controllerFor(stripe, Environment.Development);
    expect(() => controller.setOutage({ enabled: true })).toThrow(NotFoundException);
  });
});
