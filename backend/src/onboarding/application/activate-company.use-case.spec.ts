import { CompanyNotFoundException } from '../../common/errors/exceptions';
import { InMemoryCompanyRepository } from '../../testing/in-memory-onboarding';
import { ActivateCompanyUseCase } from './activate-company.use-case';

describe('ActivateCompanyUseCase', () => {
  it('reports an unknown company as a domain exception', async () => {
    const useCase = new ActivateCompanyUseCase(new InMemoryCompanyRepository());
    await expect(useCase.execute('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(CompanyNotFoundException);
  });
});
