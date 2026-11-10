import { EmailAlreadyRegisteredException } from '../common/errors/exceptions';
import { CompanyRepository } from '../onboarding/application/ports';
import { Company } from '../onboarding/domain/company.entity';
import { User } from '../onboarding/domain/user.entity';

export class InMemoryCompanyRepository extends CompanyRepository {
  readonly companies = new Map<string, Company>();
  readonly users = new Map<string, User>();

  async findById(id: string): Promise<Company | null> {
    return this.companies.get(id) ?? null;
  }

  async save(company: Company): Promise<void> {
    this.companies.set(company.id, company);
  }

  async createWithAdmin(company: Company, admin: User): Promise<void> {
    const taken = [...this.users.values()].some((user) => user.email === admin.email);
    if (taken) throw new EmailAlreadyRegisteredException();
    this.companies.set(company.id, company);
    this.users.set(admin.id, admin);
  }
}
