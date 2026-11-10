import { jest } from '@jest/globals';
import { QueryFailedError } from 'typeorm';
import { CompanyRepository } from '../src/onboarding/application/ports';
import { Company } from '../src/onboarding/domain/company.entity';
import { User } from '../src/onboarding/domain/user.entity';
import { OutboxDispatcher } from '../src/payments/application/outbox-dispatcher';
import { PaymentSynchronizer } from '../src/payments/application/payment-synchronizer';
import { Money } from '../src/payments/domain/money';
import { PaymentStatus } from '../src/payments/domain/payment-status';
import { PaymentProvider } from '../src/payments/application/ports/payment-provider';
import { MockOutcome, MockPaymentProvider } from '../src/payments/infrastructure/providers/mock-payment.provider';
import { createTestApp, TEST_JWT_SECRET, TestApp } from './support/test-app';

/**
 * A "canary" for sensitive data in logs. It runs a realistic mix of successes AND failures with logging fully on,
 * captures everything the application and its libraries print, and checks that no personal data, credential or payment
 * secret appears. It is the safety net behind "logs are a data-leak surface".
 */
describe('logs never contain sensitive data (real HTTP + PostgreSQL)', () => {
  const EMAIL = 'canary.person@acme.example';
  const FULL_NAME = 'Canary Person';
  const COMPANY_NAME = 'Canary Holdings Ltd';
  const TAX_ID = 'HU-CANARY-98765';

  let t: TestApp;
  let captured: string[];

  const asText = (args: unknown[]) =>
    args.map((arg) => (typeof arg === 'string' ? arg : arg instanceof Error ? arg.stack : JSON.stringify(arg))).join(' ');

  beforeAll(async () => {
    t = await createTestApp({ env: { LOG_LEVEL: 'debug' } });
  });
  afterAll(async () => {
    await t.close();
  });

  async function captureLogs(scenario: () => Promise<void>): Promise<string> {
    captured = [];
    const record = (...args: unknown[]) => void captured.push(asText(args));
    const spies = [
      jest.spyOn(console, 'log').mockImplementation(record),
      jest.spyOn(console, 'info').mockImplementation(record),
      jest.spyOn(console, 'warn').mockImplementation(record),
      jest.spyOn(console, 'error').mockImplementation(record),
      jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => record(String(chunk)) ?? true),
      jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => record(String(chunk)) ?? true),
    ];
    try {
      await scenario();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    return captured.join('\n');
  }

  it('across registration, a duplicate, payment, webhooks, outages and bad input', async () => {
    const provider = t.app.get(PaymentProvider) as MockPaymentProvider;
    let token = '';
    let clientSecret = '';

    const logs = await captureLogs(async () => {
      const registered = await t.http
        .post('/auth/register')
        .send({ email: EMAIL, fullName: FULL_NAME, company: { name: COMPANY_NAME, country: 'HU', taxId: TAX_ID } })
        .expect(201);
      token = registered.body.accessToken;
      const auth = { Authorization: `Bearer ${token}` };

      const company = Company.register({ name: COMPANY_NAME, country: 'HU', taxId: TAX_ID, billingEmail: EMAIL });
      const admin = User.createAdmin({ email: EMAIL, fullName: FULL_NAME, companyId: company.id });
      await expect(t.app.get(CompanyRepository).createWithAdmin(company, admin)).rejects.toThrow();

      await t.http
        .post('/auth/register')
        .send({ email: 'not-an-email', fullName: FULL_NAME, company: { name: COMPANY_NAME, country: 'ZZ' } })
        .expect(422);
      await t.http.get('/onboarding/status').set('Authorization', `Bearer ${token}tampered`).expect(401);
      await t.http.get('/nope').expect(404);
      await t.http.post('/auth/register').set('Content-Type', 'application/json').send('BODYLEAK-canary.person@acme').expect(400);
      await t.http.get('/onboarding/status?email=QUERYLEAK').set(auth).expect(200);

      const started = await t.http.post('/payments').set(auth).expect(200);
      clientSecret = started.body.clientSecret;
      expect(clientSecret).toBeTruthy();

      const failing = jest
        .spyOn(t.app.get(CompanyRepository), 'findById')
        .mockRejectedValueOnce(
          new QueryFailedError('SELECT * FROM companies WHERE billing_email = $1', [EMAIL], new Error('connection reset')),
        );
      const crashed = await t.http.get('/onboarding/status').set(auth).expect(500);
      failing.mockRestore();
      expect(crashed.body.code).toBe('INTERNAL_ERROR');

      await t.http
        .post('/webhooks/payments')
        .set('Content-Type', 'application/json')
        .set('x-mock-signature', 'forged')
        .send('{"id":"evt_x"}')
        .expect(400);
      provider.setOutage(true);
      await t.http.post('/payments').set(auth).expect(503);
      provider.setOutage(false);
      await t.http
        .post(`/dev/mock-payments/${started.body.payment.providerRef}/simulate`)
        .send({ outcome: MockOutcome.SUCCEED })
        .expect(200);
      await t.app.get(OutboxDispatcher).dispatchDue();

      const paid = await t.http.get(`/payments/${started.body.payment.id}`).set(auth).expect(200);
      expect(paid.body.status).toBe('SUCCEEDED');
      await t.app.get(PaymentSynchronizer).apply(started.body.payment.id, {
        providerRef: started.body.payment.providerRef,
        status: PaymentStatus.FAILED,
        amount: Money.of(4900, 'USD'),
        clientSecret,
        failureCode: 'card_declined',
      });
    });

    expect(logs.length).toBeGreaterThan(0);
    expect(logs).toContain('POST /auth/register -> 422');

    expect(logs).toMatch(/POST \/payments -> 200 \d+ms company=[0-9a-f-]{36}/);
    expect(logs).toMatch(/Payment [0-9a-f-]{36}: \w+ -> SUCCEEDED \[mock /);
    expect(logs).toMatch(/Company [0-9a-f-]{36} activated/);

    expect(logs).not.toContain('BODYLEAK');
    expect(logs).not.toContain('QUERYLEAK');
    expect(logs).not.toContain(EMAIL);
    expect(logs).not.toContain('canary.person');
    expect(logs).not.toContain(FULL_NAME);
    expect(logs).not.toContain(COMPANY_NAME);
    expect(logs).not.toContain(TAX_ID);
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(token.split('.')[1]);
    expect(logs).not.toContain(TEST_JWT_SECRET);
    expect(logs).not.toContain(clientSecret);
    expect(logs).not.toMatch(/_secret/);
    expect(logs).not.toMatch(/Bearer ey/);
  });
});
