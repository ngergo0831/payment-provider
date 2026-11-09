import { Company } from '../domain/company.entity';
import { User } from '../domain/user.entity';

export abstract class CompanyRepository {
  abstract findById(id: string): Promise<Company | null>;
  abstract save(company: Company): Promise<void>;
}

export abstract class UserRepository {
  /** Exact match: callers normalise the email to lower case first. */
  abstract findByEmail(email: string): Promise<User | null>;
}

/**
 * Creating a company together with its first admin must be ATOMIC: never a company without its admin,
 * and never an orphan company left behind by a failed registration.
 */
export abstract class AccountRepository {
  /**
   * @throws EmailAlreadyRegisteredException if the email is taken, including when two registrations race.
   *         In that case NOTHING is stored (the company is rolled back too).
   */
  abstract createCompanyWithAdmin(company: Company, admin: User): Promise<void>;
}
