import { Injectable } from '@nestjs/common';
import { ActivateCompanyUseCase } from '../../onboarding/application/activate-company.use-case';
import { CompanyRepository } from '../../onboarding/application/ports';
import { BillingProfile, CompanyActivation, CompanyGateway } from '../application/ports/collaborators';

@Injectable()
export class OnboardingCompanyGateway extends CompanyGateway {
  constructor(private readonly companies: CompanyRepository) {
    super();
  }

  async findBillingProfile(companyId: string): Promise<BillingProfile | null> {
    const company = await this.companies.findById(companyId);
    return company ? { companyId: company.id, isActive: company.isActive() } : null;
  }
}

@Injectable()
export class OnboardingCompanyActivation extends CompanyActivation {
  constructor(private readonly activateCompany: ActivateCompanyUseCase) {
    super();
  }

  activate(companyId: string): Promise<void> {
    return this.activateCompany.execute(companyId);
  }
}
