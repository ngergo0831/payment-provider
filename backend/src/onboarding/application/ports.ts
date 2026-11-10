import { Company } from '../domain/company.entity';
import { User } from '../domain/user.entity';

export abstract class CompanyRepository {
  abstract findById(id: string): Promise<Company | null>;

  abstract save(company: Company): Promise<void>;

  /**
   * Stores a new company together with its first admin, atomically: never a company without its admin, and never an
   * orphan company left behind by a failed registration.
   *
   * @throws EmailAlreadyRegisteredException if the admin's email is taken, including when two registrations race.
   *         In that case NOTHING is stored (the company is rolled back too).
   */
  abstract createWithAdmin(company: Company, admin: User): Promise<void>;
}
