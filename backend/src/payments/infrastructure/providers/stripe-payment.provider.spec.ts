import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import {
  InvalidWebhookSignatureException,
  PaymentProviderFailureException,
  PaymentProviderUnavailableException,
} from '../../../common/errors/payment-exceptions';
import { Money } from '../../domain/money';
import { PaymentStatus } from '../../domain/payment-status';
import { StripePaymentProvider } from './stripe-payment.provider';

const WEBHOOK_SECRET = 'whsec_unit_test_secret';
// A Stripe object used ONLY for its offline signing helper: no request is ever made with it.
const signer = new Stripe('sk_test_not_a_real_key');

const intent = (overrides: Record<string, unknown> = {}) => ({
  id: 'pi_123',
  object: 'payment_intent',
  status: 'requires_payment_method',
  amount: 4900,
  currency: 'usd',
  client_secret: 'pi_123_secret_abc',
  last_payment_error: null,
  metadata: { paymentId: 'our-payment-1', companyId: 'c1' },
  ...overrides,
});

/** A Stripe client whose API calls are scripted. Webhook verification stays REAL (Stripe's own code). */
function setup() {
  const create = jest.fn<(params: unknown, options: unknown) => Promise<unknown>>();
  const retrieve = jest.fn<(id: string) => Promise<unknown>>();
  const client = { paymentIntents: { create, retrieve }, webhooks: signer.webhooks } as unknown as Stripe;
  create.mockResolvedValue(intent());
  retrieve.mockResolvedValue(intent());
  return { create, retrieve, provider: new StripePaymentProvider({ secretKey: 'sk_test_x', webhookSecret: WEBHOOK_SECRET }, client) };
}

const request = { paymentId: 'our-payment-1', companyId: 'c1', amount: Money.of(4900, 'USD') };

describe('StripePaymentProvider', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('identifies itself, and names the header Stripe signs webhooks with', () => {
    const { provider } = setup();
    expect(provider.name).toBe('stripe');
    expect(provider.webhookSignatureHeader).toBe('stripe-signature');
  });

  describe('createPayment', () => {
    it('asks Stripe for the right thing: minor units, lower-case currency, our ids as metadata', async () => {
      const { provider, create } = setup();

      await provider.createPayment(request);

      expect(create.mock.calls[0][0]).toEqual({
        amount: 4900,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: { paymentId: 'our-payment-1', companyId: 'c1' },
      });
    });

    it('sends whole yen as-is (no x100 or /100 anywhere)', async () => {
      const { provider, create } = setup();
      await provider.createPayment({ ...request, amount: Money.of(4900, 'JPY') });
      expect(create.mock.calls[0][0]).toMatchObject({ amount: 4900, currency: 'jpy' });
    });

    it('uses our payment id as the idempotency key, so a retry cannot create a second charge', async () => {
      const { provider, create } = setup();

      await provider.createPayment(request);
      await provider.createPayment(request);

      expect(create.mock.calls.map((call) => call[1])).toEqual([
        { idempotencyKey: 'payment-create-our-payment-1' },
        { idempotencyKey: 'payment-create-our-payment-1' },
      ]);
    });

    it('returns the CURRENT state, not the stale snapshot an idempotent replay gives back', async () => {
      const { provider, create, retrieve } = setup();
      create.mockResolvedValue(intent({ status: 'requires_payment_method' })); // what a replay of the first request says
      retrieve.mockResolvedValue(intent({ status: 'succeeded' })); // what is actually true now

      const result = await provider.createPayment(request);

      expect(retrieve).toHaveBeenCalledWith('pi_123');
      expect(result.status).toBe(PaymentStatus.SUCCEEDED);
    });

    it('returns our neutral type, with nothing Stripe-shaped in it', async () => {
      const { provider } = setup();
      const result = await provider.createPayment(request);
      expect(Object.keys(result).sort()).toEqual(['amount', 'clientSecret', 'failureCode', 'providerRef', 'status']);
    });
  });

  describe('retrievePayment', () => {
    it('reads the intent and translates it', async () => {
      const { provider, retrieve } = setup();
      retrieve.mockResolvedValue(intent({ status: 'requires_action' }));

      const result = await provider.retrievePayment('pi_123');

      expect(retrieve).toHaveBeenCalledWith('pi_123');
      expect(result).toMatchObject({ providerRef: 'pi_123', status: PaymentStatus.REQUIRES_ACTION });
    });
  });

  describe('failures are translated into our two categories', () => {
    const stripeError = (ErrorClass: new (raw: never) => Error) => new ErrorClass({ message: 'details we must not leak', type: 'x' } as never);

    it.each([
      ['a connection error (network down, timeout)', () => stripeError(Stripe.errors.StripeConnectionError)],
      ['a Stripe server error (5xx)', () => stripeError(Stripe.errors.StripeAPIError)],
      ['being rate limited', () => stripeError(Stripe.errors.StripeRateLimitError)],
    ])('%s -> "unavailable, retry later"', async (_label, makeError) => {
      const { provider, create, retrieve } = setup();
      create.mockRejectedValue(makeError());
      retrieve.mockRejectedValue(makeError());

      await expect(provider.createPayment(request)).rejects.toBeInstanceOf(PaymentProviderUnavailableException);
      await expect(provider.retrievePayment('pi_123')).rejects.toBeInstanceOf(PaymentProviderUnavailableException);
    });

    it.each([
      ['a wrong API key', () => stripeError(Stripe.errors.StripeAuthenticationError)],
      ['an invalid request (our bug)', () => stripeError(Stripe.errors.StripeInvalidRequestError)],
      ['missing permissions', () => stripeError(Stripe.errors.StripePermissionError)],
      ['an idempotency conflict', () => stripeError(Stripe.errors.StripeIdempotencyError)],
      ['something that is not a Stripe error at all', () => new TypeError('bug in our code')],
    ])('%s -> "our request failed", not something the client can fix', async (_label, makeError) => {
      const { provider, create } = setup();
      create.mockRejectedValue(makeError());

      await expect(provider.createPayment(request)).rejects.toBeInstanceOf(PaymentProviderFailureException);
    });

    it('never passes Stripe\'s own message on to the client', async () => {
      const { provider, create } = setup();
      create.mockRejectedValue(stripeError(Stripe.errors.StripeAuthenticationError));

      await expect(provider.createPayment(request)).rejects.not.toThrow(/details we must not leak/);
    });
  });

  describe('parseWebhook', () => {
    const sign = (event: object, options: { secret?: string; timestamp?: number } = {}) => {
      const payload = JSON.stringify(event);
      const header = signer.webhooks.generateTestHeaderString({ payload, secret: options.secret ?? WEBHOOK_SECRET, timestamp: options.timestamp });
      return { rawBody: Buffer.from(payload), header };
    };
    const succeeded = { id: 'evt_1', object: 'event', type: 'payment_intent.succeeded', created: 1, data: { object: intent({ status: 'succeeded' }) } };

    it('accepts a correctly signed event and says which payment it is about', () => {
      const { provider } = setup();
      const { rawBody, header } = sign(succeeded);

      expect(provider.parseWebhook(rawBody, header)).toMatchObject({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        providerRef: 'pi_123',
        paymentId: 'our-payment-1',
      });
    });

    it('stores only a minimal audit record: the intent\'s client secret never reaches our database', () => {
      const { provider } = setup();
      const { rawBody, header } = sign(succeeded);

      const event = provider.parseWebhook(rawBody, header);

      expect(event?.raw).toEqual({ id: 'evt_1', type: 'payment_intent.succeeded', created: 1, paymentIntent: 'pi_123' });
      expect(JSON.stringify(event?.raw)).not.toContain('secret');
    });

    it.each([
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'payment_intent.processing',
      'payment_intent.requires_action',
      'payment_intent.canceled',
    ])('handles %s', (type) => {
      const { provider } = setup();
      const { rawBody, header } = sign({ ...succeeded, type });
      expect(provider.parseWebhook(rawBody, header)).not.toBeNull();
    });

    it.each(['customer.created', 'charge.refunded', 'payment_intent.created'])('acknowledges but ignores %s', (type) => {
      const { provider } = setup();
      const { rawBody, header } = sign({ ...succeeded, type });
      expect(provider.parseWebhook(rawBody, header)).toBeNull();
    });

    it('copes with an event that carries no metadata of ours', () => {
      const { provider } = setup();
      const { rawBody, header } = sign({ ...succeeded, data: { object: intent({ metadata: {} }) } });
      expect(provider.parseWebhook(rawBody, header)?.paymentId).toBeNull();
    });

    describe('rejects anything it cannot trust (InvalidWebhookSignatureException)', () => {
      it('a missing signature', () => {
        const { provider } = setup();
        expect(() => provider.parseWebhook(sign(succeeded).rawBody, undefined)).toThrow(InvalidWebhookSignatureException);
      });

      it('a signature made with another secret', () => {
        const { provider } = setup();
        const { rawBody, header } = sign(succeeded, { secret: 'whsec_attackers_own_secret' });
        expect(() => provider.parseWebhook(rawBody, header)).toThrow(InvalidWebhookSignatureException);
      });

      it('a body changed after signing', () => {
        const { provider } = setup();
        const { rawBody, header } = sign(succeeded);
        const tampered = Buffer.from(rawBody.toString().replace('pi_123', 'pi_999'));
        expect(() => provider.parseWebhook(tampered, header)).toThrow(InvalidWebhookSignatureException);
      });

      it('a body that was re-formatted (whitespace changes the bytes the signature covers)', () => {
        const { provider } = setup();
        const { rawBody, header } = sign(succeeded);
        const reformatted = Buffer.from(JSON.stringify(JSON.parse(rawBody.toString()), null, 2));
        expect(() => provider.parseWebhook(reformatted, header)).toThrow(InvalidWebhookSignatureException);
      });

      it('garbage in the signature header', () => {
        const { provider } = setup();
        expect(() => provider.parseWebhook(sign(succeeded).rawBody, 'not-a-signature')).toThrow(InvalidWebhookSignatureException);
      });

      it('a genuine old delivery replayed later (replay protection: the timestamp is too old)', () => {
        const { provider } = setup();
        const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
        const { rawBody, header } = sign(succeeded, { timestamp: tenMinutesAgo });
        expect(() => provider.parseWebhook(rawBody, header)).toThrow(InvalidWebhookSignatureException);
      });
    });
  });
});
