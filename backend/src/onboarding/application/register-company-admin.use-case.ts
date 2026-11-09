import { Injectable } from '@nestjs/common';
import { EmailAlreadyRegisteredException } from '../../common/errors/exceptions';
import { Company } from '../domain/company.entity';
import { normaliseEmail } from '../domain/email';
import { User } from '../domain/user.entity';
import { AccountRepository, UserRepository } from './ports';

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
  constructor(
    private readonly users: UserRepository,
    private readonly accounts: AccountRepository,
  ) {}

  async execute(command: RegisterCompanyAdminCommand): Promise<RegisteredAccount> {
    // Normalised HERE, not only in the HTTP layer: the database rejects non-lower-case emails, so a caller
    // that skips the controller (a script, a future queue consumer) must not be able to trigger a 500.
    const email = normaliseEmail(command.email);

    // Friendly fast path for the common case. It is NOT the guarantee: two requests can both pass this check.
    // The unique index is the guarantee, and the repository turns its failure into the same exception.
    if (await this.users.findByEmail(email)) {
      throw new EmailAlreadyRegisteredException();
    }

    const company = Company.register({
      name: command.company.name,
      country: command.company.country,
      taxId: command.company.taxId,
      billingEmail: command.company.billingEmail ? normaliseEmail(command.company.billingEmail) : email,
    });
    const admin = User.createAdmin({ email, fullName: command.fullName, companyId: company.id });

    await this.accounts.createCompanyWithAdmin(company, admin);
    return { company, admin };
  }
}
