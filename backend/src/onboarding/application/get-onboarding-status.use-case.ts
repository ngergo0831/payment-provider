import { Injectable } from '@nestjs/common';
import { CompanyNotFoundException } from '../../common/errors/exceptions';
import { Company } from '../domain/company.entity';
import { CompanyRepository } from './company.repository';

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
    if (!company) throw new CompanyNotFoundException();

    return { company, nextStep: company.isActive() ? OnboardingStep.DONE : OnboardingStep.PAYMENT };
  }
}
