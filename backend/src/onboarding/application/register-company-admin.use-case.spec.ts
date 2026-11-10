import { EmailAlreadyRegisteredException } from '../../common/errors/exceptions';
import { InMemoryCompanyRepository } from '../../testing/in-memory-onboarding';
import { CompanyStatus } from '../domain/company.entity';
import { RegisterCompanyAdminCommand, RegisterCompanyAdminUseCase } from './register-company-admin.use-case';

const command = (overrides: Partial<RegisterCompanyAdminCommand> = {}): RegisterCompanyAdminCommand => ({
  email: 'jane@acme.example',
  fullName: 'Jane Doe',
  company: { name: 'Acme Ltd', country: 'HU' },
  ...overrides,
});

function setup() {
  const store = new InMemoryCompanyRepository();
  return { store, useCase: new RegisterCompanyAdminUseCase(store) };
}

describe('RegisterCompanyAdminUseCase', () => {
  it('creates a company in PENDING_PAYMENT and its admin, linked together', async () => {
    const { store, useCase } = setup();

    const { company, admin } = await useCase.execute(command());

    expect(company).toMatchObject({ name: 'Acme Ltd', country: 'HU', status: CompanyStatus.PENDING_PAYMENT });
    expect(admin).toMatchObject({ email: 'jane@acme.example', fullName: 'Jane Doe', companyId: company.id });
    expect(store.companies.size).toBe(1);
    expect(store.users.size).toBe(1);
  });

  describe('billing email', () => {
    it('defaults to the admin email', async () => {
      const { useCase } = setup();
      const { company } = await useCase.execute(command());
      expect(company.billingEmail).toBe('jane@acme.example');
    });

    it('uses the one given, normalised', async () => {
      const { useCase } = setup();
      const { company } = await useCase.execute(
        command({ company: { name: 'Acme', country: 'HU', billingEmail: ' Billing@Acme.EXAMPLE ' } }),
      );
      expect(company.billingEmail).toBe('billing@acme.example');
    });
  });

  it('normalises the email itself, so a caller that skips the HTTP layer cannot violate the database rule', async () => {
    const { store, useCase } = setup();

    const { admin } = await useCase.execute(command({ email: '  Jane@ACME.example ' }));

    expect(admin.email).toBe('jane@acme.example');
    expect(store.users.get(admin.id)?.email).toBe('jane@acme.example');
  });

  it('keeps the optional tax id when given and stores null when not', async () => {
    const { useCase } = setup();
    const withTax = await useCase.execute(command({ company: { name: 'A1', country: 'HU', taxId: 'HU123456' } }));
    const withoutTax = await useCase.execute(command({ email: 'other@acme.example' }));

    expect(withTax.company.taxId).toBe('HU123456');
    expect(withoutTax.company.taxId).toBeNull();
  });

  it('rejects an email that is already registered, ignoring case, and creates nothing new', async () => {
    const { store, useCase } = setup();
    await useCase.execute(command());

    await expect(useCase.execute(command({ email: 'JANE@acme.example' }))).rejects.toBeInstanceOf(EmailAlreadyRegisteredException);

    expect(store.companies.size).toBe(1);
    expect(store.users.size).toBe(1);
  });
});
