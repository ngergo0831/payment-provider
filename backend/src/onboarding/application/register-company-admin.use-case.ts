import { Injectable } from '@nestjs/common';
import { Company } from '../domain/company.entity';
import { normalizeEmail } from '../domain/email';
import { User } from '../domain/user.entity';
import { CompanyRepository } from './ports';

export interface RegisterCompanyAdminCommand {
  email: string;
  fullName: string;
  company: {
    name: string;
    country: string;
    taxId?: string;
    billingEmail?: string;
  };
}

export interface RegisteredAccount {
  company: Company;
  admin: User;
}

@Injectable()
export class RegisterCompanyAdminUseCase {
  constructor(private readonly companies: CompanyRepository) {}

  /** @throws EmailAlreadyRegisteredException: the unique index on the email decides, so two racing registrations cannot both win. */
  async execute(command: RegisterCompanyAdminCommand): Promise<RegisteredAccount> {
    // Normalised here, not only in the HTTP layer: the database rejects non-lower-case emails, so a caller
    // that skips the controller (a script, a future queue consumer) must not be able to trigger a 500.
    const email = normalizeEmail(command.email);

    const company = Company.register({
      name: command.company.name,
      country: command.company.country,
      taxId: command.company.taxId,
      billingEmail: command.company.billingEmail ? normalizeEmail(command.company.billingEmail) : email,
    });
    const admin = User.createAdmin({
      email,
      fullName: command.fullName,
      companyId: company.id,
    });

    await this.companies.createWithAdmin(company, admin);
    return { company, admin };
  }
}
