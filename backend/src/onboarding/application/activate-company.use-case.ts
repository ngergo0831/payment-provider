import { Injectable } from '@nestjs/common';
import { CompanyNotFoundException } from '../../common/errors/exceptions';
import { CompanyRepository } from './ports';

@Injectable()
export class ActivateCompanyUseCase {
  constructor(private readonly companies: CompanyRepository) {}

  /**
   * Activates the company. IDEMPOTENT on purpose: "payment succeeded" can be delivered more than once (delivery is
   * at-least-once), and the second delivery must change nothing, not even the activation time.
   */
  async execute(companyId: string): Promise<void> {
    const company = await this.companies.findById(companyId);
    if (!company) throw new CompanyNotFoundException();
    if (company.isActive()) return;

    company.activate();
    await this.companies.save(company);
  }
}
