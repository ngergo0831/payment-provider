import { CompanyNotFoundException } from '../../common/errors/exceptions';
import { InMemoryCompanyRepository } from '../../testing/in-memory-onboarding';
import { Company, CompanyStatus } from '../domain/company.entity';
import { ActivateCompanyUseCase } from './activate-company.use-case';

function setup() {
  const store = new InMemoryCompanyRepository();
  const company = Company.register({ name: 'Acme', country: 'HU', billingEmail: 'a@b.co' });
  store.companies.set(company.id, company);
  return { company, useCase: new ActivateCompanyUseCase(store) };
}

describe('ActivateCompanyUseCase', () => {
  it('activates a company that has paid', async () => {
    const { company, useCase } = setup();

    await useCase.execute(company.id);

    expect(company.status).toBe(CompanyStatus.ACTIVE);
    expect(company.activatedAt).toBeInstanceOf(Date);
  });

  it('is idempotent: a second delivery changes nothing, not even the activation time', async () => {
    const { company, useCase } = setup();
    await useCase.execute(company.id);
    const firstActivation = company.activatedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await useCase.execute(company.id);

    expect(company.activatedAt).toBe(firstActivation);
  });

  it('reports an unknown company as a domain exception', async () => {
    const { useCase } = setup();
    await expect(useCase.execute('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(CompanyNotFoundException);
  });
});
