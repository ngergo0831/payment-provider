import { CompanyNotFoundException } from '../../common/errors/exceptions';
import { InMemoryOnboarding } from '../../testing/in-memory-onboarding';
import { Company } from '../domain/company.entity';
import { GetOnboardingStatusUseCase, OnboardingStep } from './get-onboarding-status.use-case';

function setup() {
  const store = new InMemoryOnboarding();
  const company = Company.register({ name: 'Acme', country: 'HU', billingEmail: 'a@b.co' });
  store.companies.set(company.id, company);
  return { company, useCase: new GetOnboardingStatusUseCase(store.companyRepository) };
}

describe('GetOnboardingStatusUseCase', () => {
  it('says PAYMENT is next for a company that has not paid', async () => {
    const { company, useCase } = setup();
    const status = await useCase.execute(company.id);
    expect(status.nextStep).toBe(OnboardingStep.PAYMENT);
    expect(status.company.id).toBe(company.id);
  });

  it('says DONE once the company is active', async () => {
    const { company, useCase } = setup();
    company.activate();
    expect((await useCase.execute(company.id)).nextStep).toBe(OnboardingStep.DONE);
  });

  it('reports a missing company as a domain exception (a token can outlive its company)', async () => {
    const { useCase } = setup();
    await expect(useCase.execute('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(CompanyNotFoundException);
  });
});
