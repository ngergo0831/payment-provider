import { randomUUID } from 'node:crypto';
import {
  InvalidWebhookSignatureException,
  PaymentProviderFailureException,
  PaymentProviderUnavailableException,
} from '../common/errors/exceptions';
import { PaymentProvider } from '../payments/application/ports/payment-provider';
import { Money } from '../payments/domain/money';
import { PaymentStatus } from '../payments/domain/payment-status';

export type RemoteOutcome = 'succeed' | 'decline' | 'require_action' | 'processing' | 'cancel';

/**
 * A provider under test, plus the hooks the suite needs to drive it. Hooks a provider cannot offer are OPTIONAL:
 * the tests that depend on them are skipped for that provider (a real Stripe cannot be "switched off").
 */
export interface ContractSubject {
  provider: PaymentProvider;
  outage?: { start(): void; stop(): void };
  drive?: (providerRef: string, outcome: RemoteOutcome) => void | Promise<void>;
  supportedOutcomes?: RemoteOutcome[];
  signedWebhook?: (providerRef: string, paymentId: string) => { rawBody: Buffer; signature: string };
  invalidSignature?: string;
  ignoredWebhook?: () => { rawBody: Buffer; signature: string };
}

const USD = (minor: number) => Money.of(minor, 'USD');
const input = (overrides: Partial<{ paymentId: string; amount: Money }> = {}) => ({
  paymentId: randomUUID(),
  companyId: randomUUID(),
  amount: USD(4900),
  ...overrides,
});

/**
 * THE CONTRACT TEST SUITE for `PaymentProvider` (see the contract in payment-provider.ts).
 * Call it once per adapter:  describePaymentProviderContract('MockPaymentProvider', () => ({ provider: ... }))
 * `makeSubject` is called fresh for every test, so tests never share state.
 */
export function describePaymentProviderContract(name: string, makeSubject: () => ContractSubject): void {
  describe(`PaymentProvider contract: ${name}`, () => {
    const probe = makeSubject();

    let subject: ContractSubject;
    let provider: PaymentProvider;

    beforeEach(() => {
      subject = makeSubject();
      provider = subject.provider;
    });

    const canDrive = (...outcomes: RemoteOutcome[]) =>
      outcomes.every((outcome) => probe.drive && (!probe.supportedOutcomes || probe.supportedOutcomes.includes(outcome)));

    const itIf = (capability: unknown, title: string, test: () => Promise<void> | void) =>
      (capability ? it : it.skip)(`${title}${capability ? '' : ' [not supported by this provider]'}`, async () => {
        await test();
      });

    it('has a stable name', () => {
      expect(provider.name).toMatch(/^[a-z]+$/);
    });

    it('says which header carries its webhook signature (lower-case, a valid HTTP header name)', () => {
      expect(provider.webhookSignatureHeader).toMatch(/^[a-z][a-z0-9-]*$/);
    });

    describe('createPayment', () => {
      it('creates a payment that is CREATED, with a reference and a client secret, and no failure', async () => {
        const created = await provider.createPayment(input());

        expect(created.providerRef).toEqual(expect.any(String));
        expect(created.providerRef.length).toBeGreaterThan(0);
        expect(created.status).toBe(PaymentStatus.CREATED);
        expect(created.clientSecret).toEqual(expect.any(String));
        expect(created.failureCode).toBeNull();
      });

      it('rule 1: is IDEMPOTENT: the same paymentId returns the same provider payment, never a second charge', async () => {
        const request = input();
        const first = await provider.createPayment(request);
        const second = await provider.createPayment(request);
        const third = await provider.createPayment({ ...request });

        expect(second.providerRef).toBe(first.providerRef);
        expect(third.providerRef).toBe(first.providerRef);
        expect(second.clientSecret).toBe(first.clientSecret);
      });

      it('is idempotent even when the calls overlap (a double click)', async () => {
        const request = input();
        const [a, b, c] = await Promise.all([1, 2, 3].map(() => provider.createPayment(request)));
        expect(new Set([a.providerRef, b.providerRef, c.providerRef]).size).toBe(1);
      });

      it('gives different payments different references', async () => {
        const a = await provider.createPayment(input());
        const b = await provider.createPayment(input());
        expect(a.providerRef).not.toBe(b.providerRef);
      });

      it.each([
        ['USD', 4900],
        // Odd minor units (19.99), and above every real provider's minimum charge (Stripe refuses e.g. EUR 0.01).
        ['EUR', 1999],
        ['JPY', 4900],
      ])('rule 2: reports back exactly the amount it was given (%s, %d minor units)', async (currency, minor) => {
        const amount = Money.of(minor, currency);
        const created = await provider.createPayment(input({ amount }));
        expect(created.amount.equals(amount)).toBe(true);
      });
    });

    describe('retrievePayment', () => {
      it('rule 4: reads the current state, identical to what creation returned', async () => {
        const created = await provider.createPayment(input());
        expect(await provider.retrievePayment(created.providerRef)).toEqual(created);
      });

      it('rule 3: an unknown reference is a FAILURE of ours (PaymentProviderFailureException), not an outage', async () => {
        await expect(provider.retrievePayment('does_not_exist_12345')).rejects.toBeInstanceOf(PaymentProviderFailureException);
      });
    });

    describe('payment states (the provider is the source of truth)', () => {
      itIf(canDrive('succeed'), 'SUCCEEDED: reported as SUCCEEDED, and the client secret is gone (nothing left to collect)', async () => {
        const { providerRef } = await provider.createPayment(input());
        await subject.drive!(providerRef, 'succeed');

        const state = await provider.retrievePayment(providerRef);

        expect(state.status).toBe(PaymentStatus.SUCCEEDED);
        expect(state.clientSecret).toBeNull();
        expect(state.failureCode).toBeNull();
      });

      itIf(canDrive('decline'), 'FAILED: reports a failure reason, and the secret stays so the customer can retry with another card', async () => {
        const { providerRef } = await provider.createPayment(input());
        await subject.drive!(providerRef, 'decline');

        const state = await provider.retrievePayment(providerRef);

        expect(state.status).toBe(PaymentStatus.FAILED);
        expect(state.failureCode).toEqual(expect.any(String));
        expect(state.clientSecret).toEqual(expect.any(String));
      });

      itIf(canDrive('decline', 'succeed'), 'a failed payment can still succeed on retry (a declined card is not the end)', async () => {
        const { providerRef } = await provider.createPayment(input());
        await subject.drive!(providerRef, 'decline');
        await subject.drive!(providerRef, 'succeed');

        const state = await provider.retrievePayment(providerRef);
        expect(state.status).toBe(PaymentStatus.SUCCEEDED);
        expect(state.failureCode).toBeNull();
      });

      itIf(canDrive('require_action'), 'REQUIRES_ACTION is reported as such', async () => {
        const { providerRef } = await provider.createPayment(input());
        await subject.drive!(providerRef, 'require_action');
        expect((await provider.retrievePayment(providerRef)).status).toBe(PaymentStatus.REQUIRES_ACTION);
      });

      itIf(canDrive('processing'), 'PROCESSING is reported as such', async () => {
        const { providerRef } = await provider.createPayment(input());
        await subject.drive!(providerRef, 'processing');
        expect((await provider.retrievePayment(providerRef)).status).toBe(PaymentStatus.PROCESSING);
      });

      itIf(canDrive('cancel'), 'CANCELED: reported as CANCELED with no client secret', async () => {
        const { providerRef } = await provider.createPayment(input());
        await subject.drive!(providerRef, 'cancel');

        const state = await provider.retrievePayment(providerRef);
        expect(state.status).toBe(PaymentStatus.CANCELED);
        expect(state.clientSecret).toBeNull();
      });

      itIf(canDrive('succeed', 'decline', 'cancel'), 'a SUCCEEDED payment stays SUCCEEDED whatever happens afterwards', async () => {
        const { providerRef } = await provider.createPayment(input());
        await subject.drive!(providerRef, 'succeed');
        await subject.drive!(providerRef, 'decline');
        await subject.drive!(providerRef, 'cancel');

        expect((await provider.retrievePayment(providerRef)).status).toBe(PaymentStatus.SUCCEEDED);
      });

      itIf(canDrive('succeed'), 'creating again after the payment moved on still returns the CURRENT state (idempotent create is not a reset)', async () => {
        const request = input();
        const created = await provider.createPayment(request);
        await subject.drive!(created.providerRef, 'succeed');

        const again = await provider.createPayment(request);

        expect(again.providerRef).toBe(created.providerRef);
        expect(again.status).toBe(PaymentStatus.SUCCEEDED);
      });
    });

    describe('outages (rule 3: unreachable means PaymentProviderUnavailableException, i.e. retry later)', () => {
      itIf(probe.outage, 'creation fails with the retryable error, and works again once the provider is back', async () => {
        subject.outage!.start();
        await expect(provider.createPayment(input())).rejects.toBeInstanceOf(PaymentProviderUnavailableException);

        subject.outage!.stop();
        await expect(provider.createPayment(input())).resolves.toMatchObject({ status: PaymentStatus.CREATED });
      });

      itIf(probe.outage, 'retrieval fails with the retryable error too', async () => {
        const { providerRef } = await provider.createPayment(input());
        subject.outage!.start();
        await expect(provider.retrievePayment(providerRef)).rejects.toBeInstanceOf(PaymentProviderUnavailableException);
      });

      itIf(probe.outage, 'a retry after an outage creates exactly ONE provider payment (no duplicate from the failed attempt)', async () => {
        const request = input();
        subject.outage!.start();
        await expect(provider.createPayment(request)).rejects.toBeInstanceOf(PaymentProviderUnavailableException);
        subject.outage!.stop();

        const first = await provider.createPayment(request);
        const second = await provider.createPayment(request);
        expect(second.providerRef).toBe(first.providerRef);
      });
    });

    describe('parseWebhook (rule 5: authentic webhooks only)', () => {
      itIf(probe.signedWebhook, 'accepts a correctly signed delivery and says which payment it is about', async () => {
        const request = input();
        const { providerRef } = await provider.createPayment(request);
        const { rawBody, signature } = subject.signedWebhook!(providerRef, request.paymentId);

        const event = provider.parseWebhook(rawBody, signature);

        expect(event).toMatchObject({ providerRef, paymentId: request.paymentId });
        expect(event?.id).toEqual(expect.any(String));
        expect(event?.type).toEqual(expect.any(String));
      });

      itIf(probe.signedWebhook, 'rejects a MISSING signature', async () => {
        const { rawBody } = subject.signedWebhook!('any_ref', 'any_payment');
        expect(() => provider.parseWebhook(rawBody, undefined)).toThrow(InvalidWebhookSignatureException);
      });

      itIf(probe.invalidSignature && probe.signedWebhook, 'rejects a WRONG signature', async () => {
        const { rawBody } = subject.signedWebhook!('any_ref', 'any_payment');
        expect(() => provider.parseWebhook(rawBody, subject.invalidSignature)).toThrow(InvalidWebhookSignatureException);
      });

      itIf(probe.ignoredWebhook, 'acknowledges but ignores events it does not handle (returns null, does not throw)', async () => {
        const { rawBody, signature } = subject.ignoredWebhook!();
        expect(provider.parseWebhook(rawBody, signature)).toBeNull();
      });
    });
  });
}
