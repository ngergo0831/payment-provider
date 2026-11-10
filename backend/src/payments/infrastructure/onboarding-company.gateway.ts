import { Injectable } from '@nestjs/common';
import { ActivateCompanyUseCase } from '../../onboarding/application/activate-company.use-case';
import { CompanyRepository } from '../../onboarding/application/ports';
import { BillingProfile, CompanyGateway } from '../application/ports/collaborators';

@Injectable()
export class OnboardingCompanyGateway extends CompanyGateway {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly activateCompany: ActivateCompanyUseCase,
  ) {
    super();
  }

  async findBillingProfile(companyId: string): Promise<BillingProfile | null> {
    const company = await this.companies.findById(companyId);
    return company ? { companyId: company.id, isActive: company.isActive() } : null;
  }

  activate(companyId: string): Promise<void> {
    return this.activateCompany.execute(companyId);
  }
}
