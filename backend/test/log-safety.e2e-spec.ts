import { jest } from '@jest/globals';
import type { LoggerService } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AccountRepository, CompanyRepository } from '../src/onboarding/application/ports';
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

  /** Receives every message the APPLICATION logs, at every level, through Nest's logger. */
  const applicationLogs: string[] = [];
  const recorder: LoggerService = {
    log: (...args) => void applicationLogs.push(asText(args)),
    error: (...args) => void applicationLogs.push(asText(args)),
    warn: (...args) => void applicationLogs.push(asText(args)),
    debug: (...args) => void applicationLogs.push(asText(args)),
    verbose: (...args) => void applicationLogs.push(asText(args)),
  };

  beforeAll(async () => {
    t = await createTestApp({ logger: recorder });
  });
  afterAll(async () => {
    await t.close();
  });

  /** Everything the application logged, plus whatever libraries (TypeORM) print to the console, while `scenario` runs. */
  async function captureLogs(scenario: () => Promise<void>): Promise<string> {
    captured = [];
    applicationLogs.length = 0;
    // `console.error('query failed:', query)` has several arguments: keep ALL of them, not only the first.
    const record = (...args: unknown[]) => void captured.push(asText(args));
    const spies = [
      jest.spyOn(console, 'log').mockImplementation(record),
      jest.spyOn(console, 'info').mockImplementation(record),
      jest.spyOn(console, 'warn').mockImplementation(record),
      jest.spyOn(console, 'error').mockImplementation(record),
    ];
    try {
      await scenario();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    return [...applicationLogs, ...captured].join('\n');
  }

  it('across registration, a duplicate, payment, webhooks, outages and bad input', async () => {
    const provider = t.app.get(PaymentProvider) as MockPaymentProvider;
    let token = '';
    let clientSecret = '';

    const logs = await captureLogs(async () => {
      // 1. Registration with personal data
      const registered = await t.http
        .post('/auth/register')
        .send({ email: EMAIL, fullName: FULL_NAME, company: { name: COMPANY_NAME, country: 'HU', taxId: TAX_ID } })
        .expect(201);
      token = registered.body.accessToken;
      const auth = { Authorization: `Bearer ${token}` };

      // 2. The database itself rejecting a duplicate (bypassing the friendly pre-check, as a lost race would)
      const company = Company.register({ name: COMPANY_NAME, country: 'HU', taxId: TAX_ID, billingEmail: EMAIL });
      const admin = User.createAdmin({ email: EMAIL, fullName: FULL_NAME, companyId: company.id });
      await expect(t.app.get(AccountRepository).createCompanyWithAdmin(company, admin)).rejects.toThrow();

      // 3. Validation failure echoing nothing back, a bad token, an unknown route
      await t.http.post('/auth/register').send({ email: 'not-an-email', fullName: FULL_NAME, company: { name: COMPANY_NAME, country: 'ZZ' } }).expect(422);
      await t.http.get('/onboarding/status').set('Authorization', `Bearer ${token}tampered`).expect(401);
      await t.http.get('/nope').expect(404);

      // 4. Payment, with a client secret in play
      const started = await t.http.post('/payments').set(auth).expect(200);
      clientSecret = started.body.clientSecret;
      expect(clientSecret).toBeTruthy();

      // 4b. An UNEXPECTED database failure reaching the global filter, which logs the stack. The error object carries the
      //     query and its parameters (the customer's email); they must not end up in the log text.
      const failing = jest
        .spyOn(t.app.get(CompanyRepository), 'findById')
        .mockRejectedValueOnce(new QueryFailedError('SELECT * FROM companies WHERE billing_email = $1', [EMAIL], new Error('connection reset')));
      const crashed = await t.http.get('/onboarding/status').set(auth).expect(500);
      failing.mockRestore();
      expect(crashed.body.code).toBe('INTERNAL_ERROR');

      // 5. Webhooks: a forged one, then a real one; provider outage; success and delivery
      await t.http.post('/webhooks/payments').set('Content-Type', 'application/json').set('x-mock-signature', 'forged').send('{"id":"evt_x"}').expect(400);
      provider.setOutage(true);
      await t.http.post('/payments').set(auth).expect(503);
      provider.setOutage(false);
      await t.http.post(`/dev/mock-payments/${started.body.payment.providerRef}/simulate`).send({ outcome: MockOutcome.SUCCEED }).expect(200);
      await t.app.get(OutboxDispatcher).dispatchDue();

      // 6. A stale report about a payment that already succeeded: the synchronizer rejects it and logs a warning, and the
      //    provider's record it was given carries the client secret. Neither may appear in the log.
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

    expect(logs.length).toBeGreaterThan(0); // the capture works: otherwise "nothing leaked" proves nothing
    expect(logs).toContain('POST /auth/register -> 422'); // ...and it really saw the application's own failure logging

    // Personal data
    expect(logs).not.toContain(EMAIL);
    expect(logs).not.toContain('canary.person');
    expect(logs).not.toContain(FULL_NAME);
    expect(logs).not.toContain(COMPANY_NAME);
    expect(logs).not.toContain(TAX_ID);
    // Credentials and secrets
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(token.split('.')[1]); // the token's payload part on its own
    expect(logs).not.toContain(TEST_JWT_SECRET);
    expect(logs).not.toContain(clientSecret);
    expect(logs).not.toMatch(/_secret/);
    expect(logs).not.toMatch(/Bearer ey/);
  });
});
