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
  ProviderPaymentNotFoundError,
} from '../../application/ports/payment-provider';
import { HANDLED_EVENT_TYPES, toProviderPayment } from './stripe-mappers';

export interface StripeSettings {
  secretKey: string;
  webhookSecret: string;
}

const REQUEST_TIMEOUT_MS = 10_000;
/** Safe to retry automatically because every request that changes anything carries an idempotency key. */
const MAX_NETWORK_RETRIES = 2;

export class StripePaymentProvider extends PaymentProvider {
  readonly name = 'stripe';
  readonly webhookSignatureHeader = 'stripe-signature';

  private readonly logger = new Logger(StripePaymentProvider.name);

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
          metadata: { paymentId: input.paymentId, companyId: input.companyId },
        },
        { idempotencyKey: `payment-create-${input.paymentId}` },
      ),
    );
    return this.retrievePayment(created.id);
  }

  async retrievePayment(providerRef: string): Promise<ProviderPayment> {
    return toProviderPayment(await this.call(() => this.client.paymentIntents.retrieve(providerRef), providerRef));
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): ProviderEvent | null {
    if (!signature) throw new InvalidWebhookSignatureException();

    let event: Stripe.Event;
    try {
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
    };
  }

  private async call<T>(operation: () => Promise<T>, lookedUp?: string): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (lookedUp && error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing') {
        throw new ProviderPaymentNotFoundError(lookedUp);
      }
      const unreachable =
        error instanceof Stripe.errors.StripeConnectionError ||
        error instanceof Stripe.errors.StripeAPIError ||
        error instanceof Stripe.errors.StripeRateLimitError;
      if (unreachable) {
        this.logger.warn(`Stripe unavailable: ${(error as Error).message}`);
        throw new PaymentProviderUnavailableException();
      }

      this.logger.error(`Stripe rejected the request: ${(error as Error).message}`);
      throw new PaymentProviderFailureException();
    }
  }
}
