import type Stripe from 'stripe';
import { PaymentStatus } from '../../domain/payment-status';
import { mapIntentStatus, toProviderPayment } from './stripe-mappers';

const intent = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'pi_123',
    object: 'payment_intent',
    status: 'requires_payment_method',
    amount: 4900,
    currency: 'usd',
    client_secret: 'pi_123_secret_abc',
    last_payment_error: null,
    ...overrides,
  }) as unknown as Stripe.PaymentIntent;

describe('mapIntentStatus (Stripe status -> ours)', () => {
  it.each([
    ['succeeded', null, PaymentStatus.SUCCEEDED],
    ['processing', null, PaymentStatus.PROCESSING],
    ['requires_capture', null, PaymentStatus.PROCESSING],
    ['requires_action', null, PaymentStatus.REQUIRES_ACTION],
    ['canceled', null, PaymentStatus.CANCELED],
    ['requires_confirmation', null, PaymentStatus.CREATED],
    ['requires_payment_method', null, PaymentStatus.CREATED],    ['requires_payment_method', { code: 'card_declined' }, PaymentStatus.FAILED],  ])('%s (error: %j) -> %s', (status, error, expected) => {
    expect(mapIntentStatus({ status, last_payment_error: error } as never)).toBe(expected);
  });

  it('treats a status it has never heard of as CREATED rather than crashing (the safe, non-final choice)', () => {
    expect(mapIntentStatus({ status: 'some_future_status', last_payment_error: null } as never)).toBe(PaymentStatus.CREATED);
  });
});

describe('toProviderPayment', () => {
  it('builds our neutral record: reference, status, amount, secret', () => {
    const payment = toProviderPayment(intent());
    expect(payment).toMatchObject({
      providerRef: 'pi_123',
      status: PaymentStatus.CREATED,
      clientSecret: 'pi_123_secret_abc',
      failureCode: null,
    });
    expect(payment.amount.toString()).toBe('49.00 USD');
  });

  it('keeps zero-decimal currencies whole: 4900 yen is 4900, not 49.00', () => {
    const payment = toProviderPayment(intent({ amount: 4900, currency: 'jpy' }));
    expect(payment.amount.toString()).toBe('4900 JPY');
  });

  it('withholds the client secret once the payment is final (nothing left to collect)', () => {
    expect(toProviderPayment(intent({ status: 'succeeded' })).clientSecret).toBeNull();
    expect(toProviderPayment(intent({ status: 'canceled' })).clientSecret).toBeNull();
  });

  it('keeps the client secret after a failure, so the customer can try another card', () => {
    const failed = toProviderPayment(intent({ last_payment_error: { code: 'card_declined' } }));
    expect(failed).toMatchObject({ status: PaymentStatus.FAILED, clientSecret: 'pi_123_secret_abc' });
  });

  describe('failure code: the most specific reason available', () => {
    it.each([
      [{ decline_code: 'insufficient_funds', code: 'card_declined' }, 'insufficient_funds'],
      [{ code: 'card_declined' }, 'card_declined'],
      [{}, 'payment_failed'],
    ])('%j -> %s', (error, expected) => {
      expect(toProviderPayment(intent({ last_payment_error: error })).failureCode).toBe(expected);
    });

    it('is null unless the payment actually failed', () => {
      expect(toProviderPayment(intent({ status: 'succeeded', last_payment_error: { code: 'old_error' } })).failureCode).toBeNull();
    });
  });

  it('refuses a currency we cannot charge correctly, instead of guessing its decimals', () => {
    expect(() => toProviderPayment(intent({ currency: 'huf' }))).toThrow(/Unsupported currency/);
  });
});
