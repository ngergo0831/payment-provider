import { Injectable } from '@nestjs/common';
import { CompanyNotFoundException } from '../../common/errors/company-not-found.exception';
import { Company } from '../domain/company.entity';
import { CompanyRepository } from './ports';

/** What the UI should show next. Derived from the company's state on the server, never remembered by the client. */
export enum OnboardingStep {
  PAYMENT = 'PAYMENT',
  DONE = 'DONE',
}

export interface OnboardingStatus {
  company: Company;
  nextStep: OnboardingStep;
}

@Injectable()
export class GetOnboardingStatusUseCase {
  constructor(private readonly companies: CompanyRepository) {}

  async execute(companyId: string): Promise<OnboardingStatus> {
    const company = await this.companies.findById(companyId);
    // A valid token can outlive its company (tokens are stateless): that is a 404, not a crash.
    if (!company) throw new CompanyNotFoundException();

    return { company, nextStep: company.isActive() ? OnboardingStep.DONE : OnboardingStep.PAYMENT };
  }
}
