import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import {
  InvalidWebhookSignatureException,
  PaymentProviderFailureException,
  PaymentProviderUnavailableException,
} from '../../../common/errors/exceptions';
import {
  CreateProviderPaymentInput,
  PaymentProvider,
  ProviderEvent,
  ProviderPayment,
} from '../../application/ports/payment-provider';
import { HANDLED_EVENT_TYPES, toProviderPayment } from './stripe-mappers';

export interface StripeSettings {
  secretKey: string;
  webhookSecret: string;
}

const REQUEST_TIMEOUT_MS = 10_000;
/** Safe to retry automatically because every request that changes anything carries an idempotency key. */
const MAX_NETWORK_RETRIES = 2;

/**
 * The ONLY file that knows Stripe exists. Everything it returns or throws is provider-neutral, so the rest of the
 * system could not tell Stripe from the mock (the contract test suite is what proves that).
 */
export class StripePaymentProvider extends PaymentProvider {
  readonly name = 'stripe';
  readonly webhookSignatureHeader = 'stripe-signature';

  private readonly logger = new Logger(StripePaymentProvider.name);

  /** `client` can be replaced in tests, so the translation logic is verifiable without any network. */
  constructor(
    private readonly settings: StripeSettings,
    private readonly client: Stripe = new Stripe(settings.secretKey, {
      timeout: REQUEST_TIMEOUT_MS,
      maxNetworkRetries: MAX_NETWORK_RETRIES,
    }),
  ) {
    super();
  }

  async createPayment(input: CreateProviderPaymentInput): Promise<ProviderPayment> {
    const created = await this.call(() =>
      this.client.paymentIntents.create(
        {
          amount: input.amount.amountMinor,
          currency: input.amount.currency.toLowerCase(),
          automatic_payment_methods: { enabled: true },
          // Echoed back on every event, so a webhook can find our payment even if we never stored Stripe's id.
          metadata: { paymentId: input.paymentId, companyId: input.companyId },
        },
        // Contract rule 1: the same payment id is the same idempotency key, so a retry returns the SAME intent.
        // (Stripe remembers a key for 24 hours; our flow only ever retries within minutes.)
        { idempotencyKey: `payment-create-${input.paymentId}` },
      ),
    );
    // An idempotent replay returns the response of the FIRST request, i.e. a stale snapshot. The contract promises the
    // CURRENT state (the provider is the source of truth), so read it back. One extra call, once per payment.
    return this.retrievePayment(created.id);
  }

  async retrievePayment(providerRef: string): Promise<ProviderPayment> {
    return toProviderPayment(await this.call(() => this.client.paymentIntents.retrieve(providerRef)));
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): ProviderEvent | null {
    if (!signature) throw new InvalidWebhookSignatureException();

    let event: Stripe.Event;
    try {
      // Checks the signature over the EXACT bytes and rejects timestamps older than 5 minutes (replay protection).
      event = this.client.webhooks.constructEvent(rawBody, signature, this.settings.webhookSecret);
    } catch {
      throw new InvalidWebhookSignatureException();
    }

    if (!HANDLED_EVENT_TYPES.has(event.type)) return null;

    const intent = event.data.object as Stripe.PaymentIntent;
    return {
      id: event.id,
      type: event.type,
      providerRef: intent.id,
      paymentId: intent.metadata?.paymentId ?? null,
      // Stored in the inbox for audit. Deliberately NOT the whole event: it contains the intent's client secret,
      // which would then sit in our database. Only what is needed to understand what happened.
      raw: { id: event.id, type: event.type, created: event.created, paymentIntent: intent.id },
    };
  }

  /** Translates Stripe's failures into our two categories: "try again later" and "our request was wrong". */
  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const unreachable =
        error instanceof Stripe.errors.StripeConnectionError ||
        error instanceof Stripe.errors.StripeAPIError ||
        error instanceof Stripe.errors.StripeRateLimitError;
      if (unreachable) {
        this.logger.warn(`Stripe unavailable: ${(error as Error).message}`);
        throw new PaymentProviderUnavailableException();
      }

      // Authentication, invalid request, idempotency conflict...: retrying will not help. Loud in the logs, generic to the client.
      this.logger.error(`Stripe rejected the request: ${(error as Error).message}`);
      throw new PaymentProviderFailureException();
    }
  }
}
