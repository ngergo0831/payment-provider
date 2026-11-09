import { randomUUID } from 'node:crypto';
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
import { Money } from '../../domain/money';
import { isFinal, PaymentStatus } from '../../domain/payment-status';

export const MOCK_WEBHOOK_SIGNATURE = 'mock-signature';

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

export class MockPaymentProvider extends PaymentProvider {
  readonly name = 'mock';
  readonly webhookSignatureHeader = 'x-mock-signature';

  private readonly intentsByRef = new Map<string, MockIntent>();
  private readonly refByPaymentId = new Map<string, string>();
  private outage = false;

  async createPayment(input: CreateProviderPaymentInput): Promise<ProviderPayment> {
    this.failIfOutage();

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

  setOutage(enabled: boolean): void {
    this.outage = enabled;
  }

  isOutage(): boolean {
    return this.outage;
  }

  simulate(providerRef: string, outcome: MockOutcome): ProviderEvent {
    const intent = this.mustGet(providerRef);
    if (isFinal(intent.status)) return this.eventFor(intent, 'mock.payment.noop');

    Object.assign(intent, STATE_AFTER[outcome]);
    return this.eventFor(intent, `mock.payment.${outcome}`);
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
