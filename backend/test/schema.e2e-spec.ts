import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { OPEN_STATUSES, PaymentStatus } from '../src/payments/domain/payment-status';
import { createTestApp, queryDatabase, TestApp } from './support/test-app';

/** The database schema as a whole: what exists, that it matches the code, and that its rules match the domain's. */
describe('database schema (real PostgreSQL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('applied every migration at boot, in order', async () => {
    const applied = await queryDatabase<{ name: string }>(t.databaseUrl, 'SELECT name FROM migrations ORDER BY id');
    expect(applied.map((row) => row.name)).toEqual([
      'CreateCompaniesAndUsers1794237392899',
      'CreatePaymentsAndWebhookEvents1794239203917',
    ]);
  });

  it('contains exactly the tables the migrations create (synchronize is off: entities alone create nothing)', async () => {
    const tables = await queryDatabase<{ table_name: string }>(
      t.databaseUrl,
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(tables.map((row) => row.table_name)).toEqual(['companies', 'migrations', 'payments', 'users', 'webhook_events']);
  });

  it('matches the entities exactly: no drift between the hand-written migrations and the code', async () => {
    // Asks TypeORM "what SQL would make the database match the entities?". Anything returned is drift.
    const pending = await t.app.get(DataSource).driver.createSchemaBuilder().log();
    expect(pending.upQueries.map((q) => q.query)).toEqual([]);
  });

  describe('the "one open payment per company" index agrees with the domain', () => {
    // The migration lists the open statuses as SQL text; the domain defines them as code. If they ever drift
    // apart, the double-charge guard would silently protect the wrong thing. So check every status, for real.
    const insertPayment = (status: string, companyForRow: string) =>
      queryDatabase(
        t.databaseUrl,
        `INSERT INTO payments (id, company_id, provider, amount_minor, currency, status, created_at, updated_at)
         VALUES ('${randomUUID()}', '${companyForRow}', 'mock', 4900, 'USD', '${status}', now(), now())`,
      );

    it.each(Object.values(PaymentStatus))('a %s payment blocks a second open payment only if it is itself open', async (status) => {
      const company = randomUUID();
      await queryDatabase(
        t.databaseUrl,
        `INSERT INTO companies (id, name, country, billing_email, status) VALUES ('${company}', 'Co', 'HU', 'a@b.co', 'PENDING_PAYMENT')`,
      );
      await insertPayment(status, company);

      const second = insertPayment(PaymentStatus.CREATED, company);

      if ((OPEN_STATUSES as readonly string[]).includes(status)) {
        await expect(second).rejects.toThrow(/uq_payments_one_open_per_company/);
      } else {
        await expect(second).resolves.toBeDefined(); // a final payment does not block a new attempt
      }
    });
  });
});
