import { randomUUID } from 'node:crypto';
import {
  InvalidWebhookSignatureException,
  PaymentProviderFailureException,
  PaymentProviderUnavailableException,
} from '../../../common/errors/payment-exceptions';
import {
  CreateProviderPaymentInput,
  PaymentProvider,
  ProviderEvent,
  ProviderPayment,
} from '../../application/ports/payment-provider';
import { Money } from '../../domain/money';
import { isFinal, PaymentStatus } from '../../domain/payment-status';

/** The mock's webhook "signature": a fixed value, since there is no real secret to sign with. */
export const MOCK_WEBHOOK_SIGNATURE = 'mock-signature';

/** What the "customer / bank" does to a payment, for demos and tests. */
export enum MockOutcome {
  SUCCEED = 'succeed',
  DECLINE = 'decline',
  REQUIRE_ACTION = 'require_action',
  PROCESSING = 'processing',
  CANCEL = 'cancel',
}

interface MockIntent {
  providerRef: string;
  paymentId: string;
  amount: Money;
  status: PaymentStatus;
  failureCode: string | null;
}

const STATE_AFTER: Record<MockOutcome, { status: PaymentStatus; failureCode: string | null }> = {
  [MockOutcome.SUCCEED]: { status: PaymentStatus.SUCCEEDED, failureCode: null },
  [MockOutcome.DECLINE]: { status: PaymentStatus.FAILED, failureCode: 'card_declined' },
  [MockOutcome.REQUIRE_ACTION]: { status: PaymentStatus.REQUIRES_ACTION, failureCode: null },
  [MockOutcome.PROCESSING]: { status: PaymentStatus.PROCESSING, failureCode: null },
  [MockOutcome.CANCEL]: { status: PaymentStatus.CANCELED, failureCode: null },
};

/**
 * An in-memory stand-in for Stripe that honours the SAME `PaymentProvider` contract.
 *
 * Why it exists: the whole system can be run, demoed and tested without a Stripe account, and it can
 * reproduce failure modes on demand (outage, decline, a payment that succeeds with no webhook).
 * State lives in this process and is lost on restart: for development and tests only.
 */
export class MockPaymentProvider extends PaymentProvider {
  readonly name = 'mock';
  readonly webhookSignatureHeader = 'x-mock-signature';

  private readonly intentsByRef = new Map<string, MockIntent>();
  private readonly refByPaymentId = new Map<string, string>();
  private outage = false;

  async createPayment(input: CreateProviderPaymentInput): Promise<ProviderPayment> {
    this.failIfOutage();

    // Contract rule 1: idempotent on paymentId.
    const existingRef = this.refByPaymentId.get(input.paymentId);
    if (existingRef) return this.view(this.mustGet(existingRef));

    const intent: MockIntent = {
      providerRef: `mock_pi_${randomUUID()}`,
      paymentId: input.paymentId,
      amount: input.amount,
      status: PaymentStatus.CREATED,
      failureCode: null,
    };
    this.intentsByRef.set(intent.providerRef, intent);
    this.refByPaymentId.set(input.paymentId, intent.providerRef);
    return this.view(intent);
  }

  async retrievePayment(providerRef: string): Promise<ProviderPayment> {
    this.failIfOutage();
    return this.view(this.mustGet(providerRef));
  }

  /**
   * Mock webhook format: a JSON body `{ id, type, providerRef, paymentId }` plus the fixed signature header.
   * A signed body that names no payment is "not relevant" and yields null.
   */
  parseWebhook(rawBody: Buffer, signature: string | undefined): ProviderEvent | null {
    if (signature !== MOCK_WEBHOOK_SIGNATURE) throw new InvalidWebhookSignatureException();

    let body: Partial<ProviderEvent>;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return null;
    }
    if (!body.id || !body.providerRef) return null;

    return {
      id: body.id,
      type: body.type ?? 'mock.payment.updated',
      providerRef: body.providerRef,
      paymentId: body.paymentId ?? null,
      raw: body,
    };
  }

  // ---------- controls for demos and tests (NOT part of the PaymentProvider contract) ----------

  /** While on, every provider call fails as if the provider were down. */
  setOutage(enabled: boolean): void {
    this.outage = enabled;
  }

  isOutage(): boolean {
    return this.outage;
  }

  /**
   * Moves the "remote" payment to a new state, as the customer or bank would, and returns the notification
   * the provider would send about it. A payment that is already final ignores further outcomes.
   */
  simulate(providerRef: string, outcome: MockOutcome): ProviderEvent {
    const intent = this.mustGet(providerRef);
    if (isFinal(intent.status)) return this.eventFor(intent, 'mock.payment.noop');

    Object.assign(intent, STATE_AFTER[outcome]);
    return this.eventFor(intent, `mock.payment.${outcome}`);
  }

  /** A correctly "signed" webhook delivery for a payment, ready to POST. */
  signedWebhook(providerRef: string, paymentId: string | null): { rawBody: Buffer; signature: string } {
    const body = { id: `evt_mock_${randomUUID()}`, type: 'mock.payment.updated', providerRef, paymentId };
    return { rawBody: Buffer.from(JSON.stringify(body)), signature: MOCK_WEBHOOK_SIGNATURE };
  }

  private eventFor(intent: MockIntent, type: string): ProviderEvent {
    return {
      id: `evt_mock_${randomUUID()}`,
      type,
      providerRef: intent.providerRef,
      paymentId: intent.paymentId,
      raw: { type, providerRef: intent.providerRef },
    };
  }

  private view(intent: MockIntent): ProviderPayment {
    return {
      providerRef: intent.providerRef,
      status: intent.status,
      amount: intent.amount,
      clientSecret: isFinal(intent.status) ? null : `${intent.providerRef}_secret`,
      failureCode: intent.failureCode,
    };
  }

  private mustGet(providerRef: string): MockIntent {
    const intent = this.intentsByRef.get(providerRef);
    // An unknown reference is OUR bug (or lost mock state after a restart), not an outage: no point retrying.
    if (!intent) throw new PaymentProviderFailureException();
    return intent;
  }

  private failIfOutage(): void {
    if (this.outage) throw new PaymentProviderUnavailableException();
  }
}
