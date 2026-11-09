import { PaymentProvider } from '../src/payments/application/ports/payment-provider';
import { MockOutcome, MockPaymentProvider } from '../src/payments/infrastructure/providers/mock-payment.provider';
import { buildOpenApiDocument } from '../src/swagger.setup';
import { createTestApp, queryDatabase, TestApp } from './support/test-app';

let counter = 0;

describe('POST /payments and GET /payments/:id (real HTTP + PostgreSQL)', () => {
  let t: TestApp;
  let provider: MockPaymentProvider;

  beforeAll(async () => {
    t = await createTestApp();
    provider = t.app.get(PaymentProvider) as MockPaymentProvider;
  });
  afterAll(async () => {
    await t.close();
  });
  afterEach(() => provider.setOutage(false));

  /** A registered company with its token, plus shortcuts for the calls under test. */
  const newAdmin = async () => {
    const res = await t.http
      .post('/auth/register')
      .send({ email: `pay${++counter}@acme.example`, fullName: 'Jane', company: { name: 'Acme', country: 'HU' } })
      .expect(201);
    const auth = { Authorization: `Bearer ${res.body.accessToken}` };
    return {
      companyId: res.body.company.id as string,
      auth,
      start: () => t.http.post('/payments').set(auth),
      get: (id: string) => t.http.get(`/payments/${id}`).set(auth),
      paymentRows: () => queryDatabase(t.databaseUrl, `SELECT * FROM payments WHERE company_id = '${res.body.company.id}'`),
    };
  };

  describe('starting a payment', () => {
    it('creates a payment for the plan price and returns what the browser needs to pay', async () => {
      const admin = await newAdmin();

      const res = await admin.start().expect(200);

      expect(res.body.payment).toEqual({
        id: expect.any(String),
        status: 'CREATED',
        amount: { amountMinor: 4900, currency: 'USD' },
        failureCode: null,
        providerRef: expect.stringMatching(/^mock_pi_/),
        createdAt: expect.any(String),
      });
      expect(res.body.clientSecret).toEqual(expect.any(String));
    });

    it('stores the payment, linked to the provider, and does NOT activate the company (that waits for confirmation)', async () => {
      const admin = await newAdmin();
      const { body } = await admin.start().expect(200);

      const rows = await admin.paymentRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: body.payment.id, provider: 'mock', provider_ref: body.payment.providerRef, status: 'CREATED' });

      const status = await t.http.get('/onboarding/status').set(admin.auth).expect(200);
      expect(status.body.company.status).toBe('PENDING_PAYMENT');
    });

    it('exposes nothing beyond the documented fields', async () => {
      const admin = await newAdmin();
      const { body } = await admin.start().expect(200);
      expect(Object.keys(body).sort()).toEqual(['clientSecret', 'payment']);
      expect(Object.keys(body.payment).sort()).toEqual(['amount', 'createdAt', 'failureCode', 'id', 'providerRef', 'status']);
    });
  });

  describe('is safe to call again and again', () => {
    it('a second call returns the SAME payment and the same secret', async () => {
      const admin = await newAdmin();
      const first = await admin.start().expect(200);
      const second = await admin.start().expect(200);

      expect(second.body.payment.id).toBe(first.body.payment.id);
      expect(second.body.clientSecret).toBe(first.body.clientSecret);
      expect(await admin.paymentRows()).toHaveLength(1);
    });

    it('five simultaneous clicks produce exactly ONE payment, and every click gets it', async () => {
      const admin = await newAdmin();

      const responses = await Promise.all(Array.from({ length: 5 }, () => admin.start()));

      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(new Set(responses.map((r) => r.body.payment.id)).size).toBe(1);
      expect(new Set(responses.map((r) => r.body.payment.providerRef)).size).toBe(1);
      expect(await admin.paymentRows()).toHaveLength(1);
    });
  });

  describe('when the payment provider is down', () => {
    it('answers 503 with a retryable code and keeps our intent; the next call resumes that same payment', async () => {
      const admin = await newAdmin();
      provider.setOutage(true);

      const down = await admin.start().expect(503);

      expect(down.body).toMatchObject({ statusCode: 503, code: 'PAYMENT_PROVIDER_UNAVAILABLE', requestId: expect.any(String) });
      expect(down.body.message).toMatch(/Nothing was charged/);
      const [orphan] = await admin.paymentRows();
      expect(orphan).toMatchObject({ status: 'CREATED', provider_ref: null });

      provider.setOutage(false);
      const recovered = await admin.start().expect(200);

      expect(recovered.body.payment.id).toBe(orphan.id);
      expect(recovered.body.payment.providerRef).toEqual(expect.any(String));
      expect(await admin.paymentRows()).toHaveLength(1); // still ONE payment: no duplicate from the failed attempt
    });

    it('does not leak provider internals in the error', async () => {
      const admin = await newAdmin();
      provider.setOutage(true);
      const down = await admin.start().expect(503);
      expect(JSON.stringify(down.body)).not.toMatch(/mock|stack|\.ts:/i);
    });
  });

  describe('after a declined card', () => {
    it('shows FAILED with the reason on the same payment, with a secret so another card can be tried', async () => {
      const admin = await newAdmin();
      const first = await admin.start().expect(200);
      provider.simulate(first.body.payment.providerRef, MockOutcome.DECLINE);

      const retry = await admin.start().expect(200);

      expect(retry.body.payment).toMatchObject({ id: first.body.payment.id, status: 'FAILED', failureCode: 'card_declined' });
      expect(retry.body.clientSecret).toEqual(expect.any(String));
      expect(await admin.paymentRows()).toHaveLength(1);
    });
  });

  describe('self-repair', () => {
    it('discovers a payment that succeeded with no webhook ever arriving', async () => {
      const admin = await newAdmin();
      const { body } = await admin.start().expect(200);
      provider.simulate(body.payment.providerRef, MockOutcome.SUCCEED); // the notification is lost

      const resumed = await admin.start().expect(200);

      expect(resumed.body.payment.status).toBe('SUCCEEDED');
      expect(resumed.body.clientSecret).toBeNull();
    });

    it('queues exactly ONE "payment succeeded" message however many times the success is discovered', async () => {
      const admin = await newAdmin();
      const { body } = await admin.start().expect(200);
      provider.simulate(body.payment.providerRef, MockOutcome.SUCCEED);

      await Promise.all([admin.start(), admin.start(), admin.start()]);
      await admin.start();

      const messages = await queryDatabase<{ payload: { paymentId: string; companyId: string } }>(
        t.databaseUrl,
        `SELECT payload FROM outbox_messages WHERE payload->>'paymentId' = '${body.payment.id}'`,
      );
      expect(messages).toEqual([{ payload: { paymentId: body.payment.id, companyId: admin.companyId } }]);
    });

    it('replaces a payment the provider canceled with a fresh one', async () => {
      const admin = await newAdmin();
      const first = await admin.start().expect(200);
      provider.simulate(first.body.payment.providerRef, MockOutcome.CANCEL);

      const second = await admin.start().expect(200);

      expect(second.body.payment.id).not.toBe(first.body.payment.id);
      expect(second.body.payment.status).toBe('CREATED');
      const statuses = (await admin.paymentRows()).map((row) => row.status as string).sort();
      expect(statuses).toEqual(['CANCELED', 'CREATED']);
    });
  });

  describe('refusals', () => {
    it('409 COMPANY_ALREADY_ACTIVE once the account is active, and no payment is created', async () => {
      const admin = await newAdmin();
      await queryDatabase(t.databaseUrl, `UPDATE companies SET status = 'ACTIVE', activated_at = now() WHERE id = '${admin.companyId}'`);

      const res = await admin.start().expect(409);

      expect(res.body.code).toBe('COMPANY_ALREADY_ACTIVE');
      expect(await admin.paymentRows()).toHaveLength(0);
    });

    it('401 without a token, for both endpoints', async () => {
      const post = await t.http.post('/payments').expect(401);
      expect(post.body).toMatchObject({ code: 'UNAUTHORIZED', requestId: expect.any(String) });
      await t.http.get('/payments/00000000-0000-4000-8000-000000000000').expect(401);
    });
  });

  describe('tenant scoping: the company always comes from the token', () => {
    it('two companies get two separate payments', async () => {
      const alice = await newAdmin();
      const bob = await newAdmin();

      const a = await alice.start().expect(200);
      const b = await bob.start().expect(200);

      expect(a.body.payment.id).not.toBe(b.body.payment.id);
      expect(a.body.payment.providerRef).not.toBe(b.body.payment.providerRef);
    });

    it('a company id in the body, query or a header cannot redirect the payment to someone else', async () => {
      const alice = await newAdmin();
      const bob = await newAdmin();

      const res = await t.http
        .post(`/payments?companyId=${bob.companyId}`)
        .set(alice.auth)
        .set('x-company-id', bob.companyId)
        .send({ companyId: bob.companyId })
        .expect(200);

      expect(res.body.payment.id).toEqual(expect.any(String));
      expect(await bob.paymentRows()).toHaveLength(0);
      expect(await alice.paymentRows()).toHaveLength(1);
    });
  });

  describe('GET /payments/:id', () => {
    it('returns the payment, as stored', async () => {
      const admin = await newAdmin();
      const { body } = await admin.start().expect(200);

      const res = await admin.get(body.payment.id).expect(200);

      expect(res.body).toEqual(body.payment);
    });

    it('reflects a change recorded by a later start (it reads what we stored; it does not call the provider)', async () => {
      const admin = await newAdmin();
      const { body } = await admin.start().expect(200);
      provider.simulate(body.payment.providerRef, MockOutcome.SUCCEED);

      expect((await admin.get(body.payment.id).expect(200)).body.status).toBe('CREATED'); // provider not asked yet
      await admin.start().expect(200); // a resume syncs
      expect((await admin.get(body.payment.id).expect(200)).body.status).toBe('SUCCEEDED');
    });

    it("404 PAYMENT_NOT_FOUND for another company's payment: its existence is not revealed", async () => {
      const alice = await newAdmin();
      const mallory = await newAdmin();
      const { body } = await alice.start().expect(200);

      const res = await mallory.get(body.payment.id).expect(404);

      expect(res.body).toMatchObject({ code: 'PAYMENT_NOT_FOUND', requestId: expect.any(String) });
    });

    it('404 for an unknown id, and 400 for something that is not an id at all', async () => {
      const admin = await newAdmin();
      await admin.get('00000000-0000-4000-8000-000000000000').expect(404);
      expect((await admin.get('not-a-uuid').expect(400)).body.code).toBe('BAD_REQUEST');
    });
  });

  describe('documentation', () => {
    it('documents both endpoints as secured, with their specific outcomes', () => {
      const doc = buildOpenApiDocument(t.app);
      const post = doc.paths['/payments'].post as { security?: unknown[]; responses: Record<string, unknown> };
      const get = doc.paths['/payments/{id}'].get as { security?: unknown[]; responses: Record<string, unknown> };

      expect(post.security).toEqual([{ bearer: [] }]);
      expect(Object.keys(post.responses)).toEqual(expect.arrayContaining(['200', '401', '404', '409', '502', '503']));
      expect(get.security).toEqual([{ bearer: [] }]);
      expect(Object.keys(get.responses)).toEqual(expect.arrayContaining(['200', '401', '404']));
    });
  });
});
