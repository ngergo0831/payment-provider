import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { CompanyRepository } from '../../onboarding/application/ports';
import { BillingProfile, CompanyGateway, PlanPricing } from '../application/ports/collaborators';
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
