import { EmailAlreadyRegisteredException } from '../common/errors/exceptions';
import { AccountRepository, CompanyRepository, UserRepository } from '../onboarding/application/ports';
import { Company } from '../onboarding/domain/company.entity';
import { User } from '../onboarding/domain/user.entity';

export class InMemoryOnboarding {
  readonly companies = new Map<string, Company>();
  readonly users = new Map<string, User>();

  rejectNextCreateAsDuplicate = false;

  readonly companyRepository: CompanyRepository = {
    findById: async (id) => this.companies.get(id) ?? null,
    save: async (company) => void this.companies.set(company.id, company),
  };

  readonly userRepository: UserRepository = {
    findByEmail: async (email) => [...this.users.values()].find((user) => user.email === email) ?? null,
  };

  readonly accountRepository: AccountRepository = {
    createCompanyWithAdmin: async (company, admin) => {
      const taken = [...this.users.values()].some((user) => user.email === admin.email);
      if (taken || this.rejectNextCreateAsDuplicate) {
        this.rejectNextCreateAsDuplicate = false;
        throw new EmailAlreadyRegisteredException();
      }
      this.companies.set(company.id, company);
      this.users.set(admin.id, admin);
    },
  };
}
