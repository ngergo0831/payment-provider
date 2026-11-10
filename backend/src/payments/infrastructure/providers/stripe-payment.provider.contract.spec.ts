import Stripe from 'stripe';
import { describePaymentProviderContract, RemoteOutcome } from '../../../testing/payment-provider.contract';
import { StripePaymentProvider } from './stripe-payment.provider';

/**
 * The shared PaymentProvider contract, run against the REAL Stripe API in TEST mode.
 *
 *   STRIPE_TEST_SECRET_KEY=sk_test_... npm test -- stripe-payment.provider.contract
 *
 * It needs a network and a Stripe test key, so it is skipped by default. A LIVE key (sk_live_...) is refused: this suite
 * creates payments, and must never be able to touch real money.
 */
const key = process.env.STRIPE_TEST_SECRET_KEY;
const WEBHOOK_SECRET = 'whsec_contract_test_secret';

const TEST_CARD: Partial<Record<RemoteOutcome, string>> = {
  succeed: 'pm_card_visa',
  decline: 'pm_card_chargeDeclined',
  require_action: 'pm_card_threeDSecure2Required',
};

if (!key || !key.startsWith('sk_test_')) {
  describe('PaymentProvider contract: StripePaymentProvider', () => {
    it.skip('is skipped: set STRIPE_TEST_SECRET_KEY=sk_test_... to run it against Stripe test mode', () => undefined);
  });
} else {
  const client = new Stripe(key);

  describePaymentProviderContract('StripePaymentProvider (Stripe test mode)', () => ({
    provider: new StripePaymentProvider({ secretKey: key, webhookSecret: WEBHOOK_SECRET }, client),

    // Card payments never visibly sit in "processing", so that outcome cannot be produced.
    supportedOutcomes: ['succeed', 'decline', 'require_action', 'cancel'],

    drive: async (providerRef, outcome) => {
      try {
        if (outcome === 'cancel') await client.paymentIntents.cancel(providerRef);
        else
          await client.paymentIntents.confirm(providerRef, {
            payment_method: TEST_CARD[outcome],
            return_url: 'https://example.com/return',
          });
      } catch (error) {
        // A declined card makes `confirm` throw: that IS the outcome we asked for. Acting on an already-final payment
        // is also an error in Stripe, and "nothing happens" is exactly what the contract expects there.
        if (!(error instanceof Stripe.errors.StripeCardError || error instanceof Stripe.errors.StripeInvalidRequestError)) throw error;
      }
    },

    signedWebhook: (providerRef, paymentId) => {
      const payload = JSON.stringify({
        id: 'evt_contract',
        object: 'event',
        type: 'payment_intent.succeeded',
        created: 1,
        data: { object: { id: providerRef, object: 'payment_intent', metadata: { paymentId } } },
      });
      return { rawBody: Buffer.from(payload), signature: client.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) };
    },
    invalidSignature: 't=1,v1=deadbeef',
    ignoredWebhook: () => {
      const payload = JSON.stringify({ id: 'evt_other', object: 'event', type: 'customer.created', created: 1, data: { object: {} } });
      return { rawBody: Buffer.from(payload), signature: client.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) };
    },
  }));
}
