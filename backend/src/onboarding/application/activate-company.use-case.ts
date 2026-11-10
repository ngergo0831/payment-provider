import { Injectable, Logger } from '@nestjs/common';
import { CompanyNotFoundException } from '../../common/errors/exceptions';
import { CompanyRepository } from './ports';

@Injectable()
export class ActivateCompanyUseCase {
  private readonly logger = new Logger(ActivateCompanyUseCase.name);

  constructor(private readonly companies: CompanyRepository) {}

  async execute(companyId: string): Promise<void> {
    const company = await this.companies.findById(companyId);
    if (!company) throw new CompanyNotFoundException();
    if (company.isActive()) return;

    company.activate();
    await this.companies.save(company);
    this.logger.log(`Company ${companyId} activated`);
  }
}
