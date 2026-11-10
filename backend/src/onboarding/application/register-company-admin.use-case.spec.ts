import { InMemoryCompanyRepository } from '../../testing/in-memory-onboarding';
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
  it('normalises the email itself, so a caller that skips the HTTP layer cannot violate the database rule', async () => {
    const { store, useCase } = setup();

    const { admin } = await useCase.execute(command({ email: '  Jane@ACME.example ' }));

    expect(admin.email).toBe('jane@acme.example');
    expect(store.users.get(admin.id)?.email).toBe('jane@acme.example');
  });
});
