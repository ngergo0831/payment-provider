import { EmailAlreadyRegisteredException } from '../common/errors/email-already-registered.exception';
import { AccountRepository, CompanyRepository, UserRepository } from '../onboarding/application/ports';
import { Company } from '../onboarding/domain/company.entity';
import { User } from '../onboarding/domain/user.entity';

/**
 * Hand-written in-memory implementations of the onboarding ports, for unit tests: fast, deterministic,
 * no database. They honour the port contracts (atomic create, duplicate emails rejected).
 * Excluded from the production build (tsconfig.build.json).
 */
export class InMemoryOnboarding {
  readonly companies = new Map<string, Company>();
  readonly users = new Map<string, User>();

  /** Set to simulate losing a race: the pre-check passed, but the unique index rejects the insert. */
  rejectNextCreateAsDuplicate = false;

  readonly companyRepository: CompanyRepository = {
    findById: async (id) => this.companies.get(id) ?? null,
    save: async (company) => void this.companies.set(company.id, company),
  };

  readonly userRepository: UserRepository = {
    findById: async (id) => this.users.get(id) ?? null,
    findByEmail: async (email) => [...this.users.values()].find((user) => user.email === email) ?? null,
  };

  readonly accountRepository: AccountRepository = {
    createCompanyWithAdmin: async (company, admin) => {
      const taken = [...this.users.values()].some((user) => user.email === admin.email);
      if (taken || this.rejectNextCreateAsDuplicate) {
        this.rejectNextCreateAsDuplicate = false;
        throw new EmailAlreadyRegisteredException(); // and nothing is stored: atomic
      }
      this.companies.set(company.id, company);
      this.users.set(admin.id, admin);
    },
  };
}
