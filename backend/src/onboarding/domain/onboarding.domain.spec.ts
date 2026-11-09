import { Company, CompanyStatus } from './company.entity';
import { User, UserRole } from './user.entity';

const newCompany = () =>
  Company.register({ name: 'Acme Ltd', country: 'HU', taxId: 'HU12345678', billingEmail: 'billing@acme.example' });

describe('Company', () => {
  it('registers as PENDING_PAYMENT: never active before paying', () => {
    const company = newCompany();
    expect(company.status).toBe(CompanyStatus.PENDING_PAYMENT);
    expect(company.isActive()).toBe(false);
    expect(company.activatedAt).toBeNull();
  });

  it('gets a unique id from the application, before any database is involved', () => {
    expect(newCompany().id).toMatch(/^[0-9a-f-]{36}$/);
    expect(newCompany().id).not.toBe(newCompany().id);
  });

  it('stores a missing tax id as null, not undefined', () => {
    const company = Company.register({ name: 'No Tax', country: 'DE', billingEmail: 'a@b.co' });
    expect(company.taxId).toBeNull();
  });

  it('activates, recording when', () => {
    const company = newCompany();
    const when = new Date('2026-11-09T12:00:00Z');

    company.activate(when);

    expect(company.isActive()).toBe(true);
    expect(company.activatedAt).toEqual(when);
  });

  it('activation is idempotent: a repeated success report does not move the activation time', () => {
    const company = newCompany();
    const first = new Date('2026-11-09T12:00:00Z');
    company.activate(first);

    company.activate(new Date('2026-11-10T08:00:00Z'));

    expect(company.activatedAt).toEqual(first);
  });
});

describe('User', () => {
  it('is created as an ADMIN of the given company', () => {
    const user = User.createAdmin({ email: 'jane@acme.example', fullName: 'Jane Doe', companyId: 'company-1' });
    expect(user).toMatchObject({ email: 'jane@acme.example', fullName: 'Jane Doe', role: UserRole.ADMIN, companyId: 'company-1' });
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
