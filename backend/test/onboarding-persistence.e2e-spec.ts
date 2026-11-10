import { CompanyRepository } from '../src/onboarding/application/ports';
import { Company, CompanyStatus } from '../src/onboarding/domain/company.entity';
import { User } from '../src/onboarding/domain/user.entity';
import { createTestApp, queryDatabase, TestApp } from './support/test-app';

describe('onboarding persistence (real PostgreSQL)', () => {
  let t: TestApp;
  let companies: CompanyRepository;

  const company = () => Company.register({ name: 'Acme Ltd', country: 'HU', taxId: 'HU1', billingEmail: 'billing@acme.example' });
  const admin = (companyId: string, email = `jane-${Math.random().toString(16).slice(2)}@acme.example`) =>
    User.createAdmin({ email, fullName: 'Jane Doe', companyId });

  beforeAll(async () => {
    t = await createTestApp();
    companies = t.app.get(CompanyRepository);
  });
  afterAll(async () => {
    await t.close();
  });

  describe('companies', () => {
    it('stores and returns a company with its defaults', async () => {
      const original = company();
      await companies.save(original);

      const loaded = await companies.findById(original.id);

      expect(loaded).toMatchObject({
        id: original.id,
        name: 'Acme Ltd',
        country: 'HU',
        taxId: 'HU1',
        billingEmail: 'billing@acme.example',
        status: CompanyStatus.PENDING_PAYMENT,
        activatedAt: null,
      });
      expect(loaded?.createdAt).toBeInstanceOf(Date);
    });

    it('the database itself rejects an invalid status, whatever the code does', async () => {
      const original = company();
      await companies.save(original);
      const bad = queryDatabase(t.databaseUrl, `UPDATE companies SET status = 'HACKED' WHERE id = '${original.id}'`);
      await expect(bad).rejects.toThrow(/ck_companies_status/);
    });
  });

  describe('rules enforced by the database itself', () => {
    it('rejects an email that is not lower case (so uniqueness is effectively case-insensitive)', async () => {
      const c = company();
      await companies.save(c);
      const bad = queryDatabase(
        t.databaseUrl,
        `INSERT INTO users (id, email, full_name, company_id) VALUES (gen_random_uuid(), 'Jane@Acme.example', 'J', '${c.id}')`,
      );
      await expect(bad).rejects.toThrow(/ck_users_email_lowercase/);
    });

    it('rejects a user whose company does not exist', async () => {
      const bad = queryDatabase(
        t.databaseUrl,
        `INSERT INTO users (id, email, full_name, company_id)
         VALUES (gen_random_uuid(), 'orphan@acme.example', 'J', '00000000-0000-4000-8000-000000000000')`,
      );
      await expect(bad).rejects.toThrow(/fk_users_company/);
    });

    it('refuses to delete a company that still has users', async () => {
      const c = company();
      await companies.createWithAdmin(c, admin(c.id));
      await expect(queryDatabase(t.databaseUrl, `DELETE FROM companies WHERE id = '${c.id}'`)).rejects.toThrow(/fk_users_company/);
    });
  });
});
