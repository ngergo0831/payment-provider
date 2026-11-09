import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { ActivateCompanyUseCase } from '../../onboarding/application/activate-company.use-case';
import { CompanyRepository } from '../../onboarding/application/ports';
import { BillingProfile, CompanyActivation, CompanyGateway, PlanPricing } from '../application/ports/collaborators';
import { Money } from '../domain/money';

/** Adapts onboarding's repository to the narrow view payments needs. */
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

/** Lets payments ask onboarding to activate a company, without importing onboarding's internals. */
@Injectable()
export class OnboardingCompanyActivation extends CompanyActivation {
  constructor(private readonly activateCompany: ActivateCompanyUseCase) {
    super();
  }

  activate(companyId: string): Promise<void> {
    return this.activateCompany.execute(companyId);
  }
}

/** The plan price from configuration, already validated at startup. */
@Injectable()
export class ConfigPlanPricing extends PlanPricing {
  readonly price: Money;

  constructor(config: ConfigService<AppConfig, true>) {
    super();
    const { priceMinor, currency } = config.get('payments', { infer: true }).plan;
    this.price = Money.of(priceMinor, currency);
  }
}
