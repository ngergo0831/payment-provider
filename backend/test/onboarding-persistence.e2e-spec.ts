import { EmailAlreadyRegisteredException } from '../src/common/errors/exceptions';
import { AccountRepository, CompanyRepository, UserRepository } from '../src/onboarding/application/ports';
import { Company, CompanyStatus } from '../src/onboarding/domain/company.entity';
import { User, UserRole } from '../src/onboarding/domain/user.entity';
import { createTestApp, queryDatabase, TestApp } from './support/test-app';

describe('onboarding persistence (real PostgreSQL)', () => {
  let t: TestApp;
  let companies: CompanyRepository;
  let users: UserRepository;
  let accounts: AccountRepository;

  const company = () => Company.register({ name: 'Acme Ltd', country: 'HU', taxId: 'HU1', billingEmail: 'billing@acme.example' });
  const admin = (companyId: string, email = `jane-${Math.random().toString(16).slice(2)}@acme.example`) =>
    User.createAdmin({ email, fullName: 'Jane Doe', companyId });

  beforeAll(async () => {
    t = await createTestApp();
    companies = t.app.get(CompanyRepository);
    users = t.app.get(UserRepository);
    accounts = t.app.get(AccountRepository);
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

    it('returns null for an unknown id', async () => {
      expect(await companies.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
    });

    it('persists activation', async () => {
      const original = company();
      await companies.save(original);

      const loaded = (await companies.findById(original.id)) as Company;
      loaded.activate(new Date('2026-11-09T12:00:00Z'));
      await companies.save(loaded);

      const reloaded = await companies.findById(original.id);
      expect(reloaded?.status).toBe(CompanyStatus.ACTIVE);
      expect(reloaded?.activatedAt).toEqual(new Date('2026-11-09T12:00:00Z'));
    });

    it('the database itself rejects an invalid status, whatever the code does', async () => {
      const original = company();
      await companies.save(original);
      const bad = queryDatabase(t.databaseUrl, `UPDATE companies SET status = 'HACKED' WHERE id = '${original.id}'`);
      await expect(bad).rejects.toThrow(/ck_companies_status/);
    });
  });

  describe('creating a company with its admin', () => {
    it('stores both, and the user is found by id and by email', async () => {
      const c = company();
      const u = admin(c.id, 'jane@acme.example');

      await accounts.createCompanyWithAdmin(c, u);

      expect(await companies.findById(c.id)).not.toBeNull();
      expect(await users.findByEmail('jane@acme.example')).toMatchObject({ id: u.id, companyId: c.id, role: UserRole.ADMIN });
      expect(await users.findById(u.id)).toMatchObject({ email: 'jane@acme.example', fullName: 'Jane Doe' });
    });

    it('returns null when no user has that email', async () => {
      expect(await users.findByEmail('nobody@nowhere.example')).toBeNull();
    });

    it('rejects a duplicate email with a DOMAIN exception, and stores NOTHING (no orphan company)', async () => {
      const first = company();
      await accounts.createCompanyWithAdmin(first, admin(first.id, 'taken@acme.example'));

      const second = company();
      await expect(accounts.createCompanyWithAdmin(second, admin(second.id, 'taken@acme.example'))).rejects.toBeInstanceOf(
        EmailAlreadyRegisteredException,
      );

      expect(await companies.findById(second.id)).toBeNull(); // the transaction rolled the company back
    });

    it('survives two simultaneous registrations with the same email: exactly one wins', async () => {
      const a = company();
      const b = company();

      const results = await Promise.allSettled([
        accounts.createCompanyWithAdmin(a, admin(a.id, 'race@acme.example')),
        accounts.createCompanyWithAdmin(b, admin(b.id, 'race@acme.example')),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(loser.reason).toBeInstanceOf(EmailAlreadyRegisteredException);

      const [{ count }] = await queryDatabase<{ count: string }>(t.databaseUrl, "SELECT count(*) FROM users WHERE email = 'race@acme.example'");
      expect(count).toBe('1');
    });
  });

  describe('rules enforced by the database itself', () => {
    it('rejects an email that is not lower case (so uniqueness is effectively case-insensitive)', async () => {
      const c = company();
      await companies.save(c);
      const bad = queryDatabase(
        t.databaseUrl,
        `INSERT INTO users (id, email, full_name, role, company_id) VALUES (gen_random_uuid(), 'Jane@Acme.example', 'J', 'ADMIN', '${c.id}')`,
      );
      await expect(bad).rejects.toThrow(/ck_users_email_lowercase/);
    });

    it('rejects a user whose company does not exist', async () => {
      const bad = queryDatabase(
        t.databaseUrl,
        `INSERT INTO users (id, email, full_name, role, company_id)
         VALUES (gen_random_uuid(), 'orphan@acme.example', 'J', 'ADMIN', '00000000-0000-4000-8000-000000000000')`,
      );
      await expect(bad).rejects.toThrow(/fk_users_company/);
    });

    it('refuses to delete a company that still has users', async () => {
      const c = company();
      await accounts.createCompanyWithAdmin(c, admin(c.id));
      await expect(queryDatabase(t.databaseUrl, `DELETE FROM companies WHERE id = '${c.id}'`)).rejects.toThrow(/fk_users_company/);
    });
  });
});
