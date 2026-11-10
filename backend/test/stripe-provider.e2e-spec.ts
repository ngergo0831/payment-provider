import Stripe from 'stripe';
import { PaymentProvider } from '../src/payments/application/ports/payment-provider';
import { StripePaymentProvider } from '../src/payments/infrastructure/providers/stripe-payment.provider';
import { createTestApp, TestApp } from './support/test-app';

const STRIPE_ENV = {
  PAYMENT_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_test_SUPERSECRET_dummy_key',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_public_dummy_key',
  STRIPE_WEBHOOK_SECRET: 'whsec_e2e_signing_secret',
};
const signer = new Stripe('sk_test_not_a_real_key');

// Its own file: the app's module graph (e.g. whether the mock's dev endpoints exist) is fixed by the first app a test
// file boots, so one file cannot boot both providers.
describe('provider selection by configuration (real HTTP + PostgreSQL)', () => {
  describe('PAYMENT_PROVIDER=stripe', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp({ env: STRIPE_ENV });
    });
    afterAll(async () => {
      await t.close();
    });

    it('uses the Stripe adapter', () => {
      expect(t.app.get(PaymentProvider)).toBeInstanceOf(StripePaymentProvider);
    });

    describe('GET /checkout-config', () => {
      it('publishes the PUBLISHABLE key and the price', async () => {
        const res = await t.http.get('/checkout-config').expect(200);
        expect(res.body).toEqual({
          provider: 'stripe',
          publishableKey: 'pk_test_public_dummy_key',
          price: { amountMinor: 4900, currency: 'USD' },
        });
      });

      it('never exposes the secret key or the webhook secret, anywhere in the response', async () => {
        const res = await t.http.get('/checkout-config').expect(200);
        const text = JSON.stringify(res.body) + JSON.stringify(res.headers);
        expect(text).not.toContain('SUPERSECRET');
        expect(text).not.toContain('whsec_');
        expect(text).not.toContain('sk_test');
      });
    });

    describe('POST /webhooks/payments with real Stripe signatures, through the whole HTTP stack', () => {
      const event = (type = 'payment_intent.succeeded', intentId = 'pi_not_one_of_ours') => ({
        id: 'evt_e2e_1',
        object: 'event',
        type,
        created: 1,
        data: { object: { id: intentId, object: 'payment_intent', status: 'succeeded', metadata: { note: 'Árvíztűrő tükörfúrógép' } } },
      });
      const post = (body: object, options: { secret?: string; timestamp?: number; resend?: string } = {}) => {
        const payload = JSON.stringify(body, null, 2);
        const header = signer.webhooks.generateTestHeaderString({
          payload,
          secret: options.secret ?? STRIPE_ENV.STRIPE_WEBHOOK_SECRET,
          timestamp: options.timestamp,
        });
        return t.http
          .post('/webhooks/payments')
          .set('Content-Type', 'application/json')
          .set('stripe-signature', header)
          .send(options.resend ?? payload);
      };

      it('accepts a correctly signed event. Signature checking needs the EXACT bytes, so this proves the raw body is preserved', async () => {
        const res = await post(event()).expect(200);
        expect(res.body).toEqual({ received: true, result: 'UNKNOWN_PAYMENT' });
      });

      it('rejects a different secret', async () => {
        const res = await post(event(), { secret: 'whsec_attackers_own' }).expect(400);
        expect(res.body.code).toBe('INVALID_WEBHOOK_SIGNATURE');
      });

      it('rejects a body that was merely re-formatted (same JSON, different bytes)', async () => {
        await post(event(), { resend: JSON.stringify(event()) }).expect(400);
      });

      it("rejects a missing signature, and a signature in the mock's header", async () => {
        await t.http.post('/webhooks/payments').set('Content-Type', 'application/json').send(JSON.stringify(event())).expect(400);
        await t.http
          .post('/webhooks/payments')
          .set('Content-Type', 'application/json')
          .set('x-mock-signature', 'mock-signature')
          .send(JSON.stringify(event()))
          .expect(400);
      });

      it('acknowledges events it does not handle', async () => {
        const res = await post(event('customer.created')).expect(200);
        expect(res.body.result).toBe('IGNORED');
      });
    });

    it('hides the mock simulator completely: it does not exist when Stripe is in use', async () => {
      await t.http.post('/dev/mock-payments/outage').send({ enabled: true }).expect(404);
      await t.http.post('/dev/mock-payments/pi_x/simulate').send({ outcome: 'succeed' }).expect(404);
    });
  });
});
