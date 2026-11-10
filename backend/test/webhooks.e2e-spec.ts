import { OutboxDispatcher } from '../src/payments/application/outbox-dispatcher';
import { PaymentProvider } from '../src/payments/application/ports/payment-provider';
import { MOCK_WEBHOOK_SIGNATURE, MockPaymentProvider } from '../src/payments/infrastructure/providers/mock-payment.provider';
import { buildOpenApiDocument } from '../src/swagger.setup';
import { signedMockWebhook } from '../src/testing/mock-webhook';
import { companyStatus, registerCompany } from './support/companies';
import { createTestApp, queryDatabase, TestApp } from './support/test-app';

describe('webhooks and the mock simulator (real HTTP + PostgreSQL)', () => {
  let t: TestApp;
  let provider: MockPaymentProvider;
  let dispatcher: OutboxDispatcher;
  const HEADER = 'x-mock-signature';

  beforeAll(async () => {
    t = await createTestApp();
    provider = t.app.get(PaymentProvider) as MockPaymentProvider;
    dispatcher = t.app.get(OutboxDispatcher);
  });
  afterAll(async () => {
    await t.close();
  });
  afterEach(() => provider.setOutage(false));

  const newAdmin = async () => {
    const company = await registerCompany(t);
    return {
      companyId: company.companyId,
      start: () => t.http.post('/payments').set(company.auth),
      payment: (id: string) => t.http.get(`/payments/${id}`).set(company.auth),
      companyStatus: () => companyStatus(t, company),
    };
  };
  const simulate = (providerRef: string, outcome: string, deliverWebhook?: boolean) =>
    t.http.post(`/dev/mock-payments/${providerRef}/simulate`).send({ outcome, deliverWebhook });
  // `null` means "send NO signature". (`undefined` would trigger the default value, i.e. silently send a valid one.)
  const deliver = (body: object, signature: string | null = MOCK_WEBHOOK_SIGNATURE) => {
    const request = t.http.post('/webhooks/payments').set('Content-Type', 'application/json');
    return (signature === null ? request : request.set(HEADER, signature)).send(JSON.stringify(body));
  };

  describe('the webhook endpoint', () => {
    it('applies a correctly signed notification: the payment is SUCCEEDED, with no customer action involved', async () => {
      const admin = await newAdmin();
      const { body } = await admin.start().expect(200);
      await simulate(body.payment.providerRef, 'succeed', false).expect(200);

      const hook = signedMockWebhook(body.payment.providerRef, body.payment.id);
      const res = await deliver(JSON.parse(hook.rawBody.toString())).expect(200);

      expect(res.body).toEqual({ received: true, result: 'PROCESSED' });
      expect((await admin.payment(body.payment.id).expect(200)).body.status).toBe('SUCCEEDED');
    });

    it('rejects a missing or wrong signature with 400, and changes nothing', async () => {
      const admin = await newAdmin();
      const { body } = await admin.start().expect(200);
      await simulate(body.payment.providerRef, 'succeed', false).expect(200);
      const forged = { id: 'evt_forged', providerRef: body.payment.providerRef, paymentId: body.payment.id };

      const missing = await deliver(forged, null).expect(400);
      await deliver(forged, 'attackers-guess').expect(400);

      expect(missing.body).toMatchObject({ statusCode: 400, code: 'INVALID_WEBHOOK_SIGNATURE', requestId: expect.any(String) });
      expect((await admin.payment(body.payment.id).expect(200)).body.status).toBe('CREATED');
    });

    it('acknowledges (200 CONFLICT) a notification whose payment no longer matches ours, instead of a 500 retried for days', async () => {
      const admin = await newAdmin();
      const { body } = await admin.start().expect(200);
      await simulate(body.payment.providerRef, 'succeed', false).expect(200);
      await queryDatabase(t.databaseUrl, `UPDATE payments SET amount_minor = 100 WHERE id = '${body.payment.id}'`);

      const hook = signedMockWebhook(body.payment.providerRef, body.payment.id);
      const res = await deliver(JSON.parse(hook.rawBody.toString())).expect(200);

      expect(res.body).toEqual({ received: true, result: 'CONFLICT' });
      expect((await admin.payment(body.payment.id).expect(200)).body.status).toBe('CREATED');
    });

    it('handles a redelivery of the same event again, harmlessly', async () => {
      const admin = await newAdmin();
      const { body } = await admin.start().expect(200);
      await simulate(body.payment.providerRef, 'succeed', false).expect(200);
      const event = { id: 'evt_dup_1', providerRef: body.payment.providerRef, paymentId: body.payment.id };

      const first = await deliver(event).expect(200);
      const second = await deliver(event).expect(200);

      expect(first.body.result).toBe('PROCESSED');
      expect(second.body.result).toBe('PROCESSED');
      expect((await admin.payment(body.payment.id).expect(200)).body.status).toBe('SUCCEEDED');
    });

    it('five simultaneous deliveries of the same event queue ONE "payment succeeded" message', async () => {
      const admin = await newAdmin();
      const { body } = await admin.start().expect(200);
      await simulate(body.payment.providerRef, 'succeed', false).expect(200);
      const event = { id: 'evt_race_1', providerRef: body.payment.providerRef, paymentId: body.payment.id };

      const responses = await Promise.all(Array.from({ length: 5 }, () => deliver(event)));

      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      const messages = await queryDatabase(
        t.databaseUrl,
        `SELECT 1 FROM outbox_messages WHERE payload->>'paymentId' = '${body.payment.id}'`,
      );
      expect(messages).toHaveLength(1);
    });

    it('acknowledges (200) events about payments that are not ours, so the provider stops retrying', async () => {
      const res = await deliver({ id: 'evt_stranger', providerRef: 'pi_not_ours', paymentId: null }).expect(200);
      expect(res.body.result).toBe('UNKNOWN_PAYMENT');
    });

    it('acknowledges (200) a signed message it has no use for', async () => {
      const res = await deliver({ type: 'something.unrelated' }).expect(200);
      expect(res.body).toEqual({ received: true, result: 'IGNORED' });
    });
  });

  describe("when handling fails part-way (provider down), the provider's retry still works", () => {
    it('answers 503, so the provider retries; the retry after recovery succeeds', async () => {
      const admin = await newAdmin();
      const { body } = await admin.start().expect(200);
      await simulate(body.payment.providerRef, 'succeed', false).expect(200);
      const event = { id: 'evt_retry_1', providerRef: body.payment.providerRef, paymentId: body.payment.id };

      provider.setOutage(true);
      const down = await deliver(event).expect(503);
      expect(down.body.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
      expect((await admin.payment(body.payment.id).expect(200)).body.status).toBe('CREATED');

      provider.setOutage(false);
      const retry = await deliver(event).expect(200);

      expect(retry.body.result).toBe('PROCESSED');
      expect((await admin.payment(body.payment.id).expect(200)).body.status).toBe('SUCCEEDED');
    });
  });

  describe('the whole flow, driven like a person would from Swagger', () => {
    it('register -> pay -> simulate "succeed" (webhook sent automatically) -> delivery -> ACTIVE', async () => {
      const admin = await newAdmin();
      const { body } = await admin.start().expect(200);

      const sim = await simulate(body.payment.providerRef, 'succeed').expect(200);
      expect(sim.body).toEqual({ webhook: 'PROCESSED' });
      expect((await admin.payment(body.payment.id).expect(200)).body.status).toBe('SUCCEEDED');
      expect(await admin.companyStatus()).toBe('PENDING_PAYMENT');

      await dispatcher.dispatchDue();

      expect(await admin.companyStatus()).toBe('ACTIVE');
    });

    it('simulate "decline" -> FAILED with a reason; the customer retries on the same payment and succeeds', async () => {
      const admin = await newAdmin();
      const { body } = await admin.start().expect(200);

      await simulate(body.payment.providerRef, 'decline').expect(200);
      const failed = (await admin.payment(body.payment.id).expect(200)).body;
      expect(failed).toMatchObject({ status: 'FAILED', failureCode: 'card_declined' });

      await simulate(body.payment.providerRef, 'succeed').expect(200);
      expect((await admin.payment(body.payment.id).expect(200)).body).toMatchObject({ status: 'SUCCEEDED', failureCode: null });
    });

    it('simulate with deliverWebhook=false models a LOST webhook: nothing changes until the customer resumes checkout', async () => {
      const admin = await newAdmin();
      const { body } = await admin.start().expect(200);

      const sim = await simulate(body.payment.providerRef, 'succeed', false).expect(200);

      expect(sim.body).toEqual({ webhook: 'NOT_DELIVERED' });
      expect((await admin.payment(body.payment.id).expect(200)).body.status).toBe('CREATED');
      await admin.start().expect(200);
      expect((await admin.payment(body.payment.id).expect(200)).body.status).toBe('SUCCEEDED');
    });

    it('the outage switch makes payments answer 503, and switching it off recovers', async () => {
      const admin = await newAdmin();

      expect((await t.http.post('/dev/mock-payments/outage').send({ enabled: true }).expect(200)).body).toEqual({ outage: true });
      expect((await admin.start().expect(503)).body.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');

      await t.http.post('/dev/mock-payments/outage').send({ enabled: false }).expect(200);
      await admin.start().expect(200);
    });

    it('validates its input: an unknown outcome is a 422 with the field named', async () => {
      const res = await simulate('mock_pi_x', 'explode').expect(422);
      expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'outcome' })]));
    });

    it('an unknown payment reference is a clean 404, not a crash', async () => {
      const res = await simulate('mock_pi_does_not_exist', 'succeed').expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });

  describe('production safety', () => {
    it('the app REFUSES to start in production with the mock provider (its webhook signature is public), and leaves nothing behind', async () => {
      await expect(createTestApp({ env: { NODE_ENV: 'production' } })).rejects.toThrow(/PAYMENT_PROVIDER=mock is not allowed/);
    });
  });

  describe('documentation', () => {
    it('documents the webhook endpoint (200, and 400 for a bad signature) and tags the simulator as dev-only', () => {
      const doc = buildOpenApiDocument(t.app);
      const webhook = doc.paths['/webhooks/payments'].post as { responses: Record<string, unknown>; security?: unknown };

      expect(Object.keys(webhook.responses)).toEqual(expect.arrayContaining(['200', '400']));
      expect(webhook.security).toBeUndefined();
      expect(doc.paths['/dev/mock-payments/{providerRef}/simulate'].post).toMatchObject({ tags: ['dev (mock provider only)'] });
    });
  });
});
