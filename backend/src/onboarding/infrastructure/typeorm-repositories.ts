import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { isUniqueViolation } from '../../common/database/pg-errors';
import { EmailAlreadyRegisteredException } from '../../common/errors/email-already-registered.exception';
import { AccountRepository, CompanyRepository, UserRepository } from '../application/ports';
import { Company } from '../domain/company.entity';
import { User } from '../domain/user.entity';

/** Must match the constraint name declared on the User entity and created by the migration. */
const UNIQUE_USER_EMAIL = 'uq_users_email';

@Injectable()
export class TypeOrmCompanyRepository extends CompanyRepository {
  constructor(@InjectRepository(Company) private readonly repository: Repository<Company>) {
    super();
  }

  findById(id: string): Promise<Company | null> {
    return this.repository.findOneBy({ id });
  }

  async save(company: Company): Promise<void> {
    await this.repository.save(company);
  }
}

@Injectable()
export class TypeOrmUserRepository extends UserRepository {
  constructor(@InjectRepository(User) private readonly repository: Repository<User>) {
    super();
  }

  findById(id: string): Promise<User | null> {
    return this.repository.findOneBy({ id });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.repository.findOneBy({ email });
  }
}

@Injectable()
export class TypeOrmAccountRepository extends AccountRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  async createCompanyWithAdmin(company: Company, admin: User): Promise<void> {
    try {
      // One transaction: if the user insert fails, the company insert is rolled back.
      await this.dataSource.transaction(async (manager) => {
        await manager.insert(Company, company);
        await manager.insert(User, admin);
      });
    } catch (error) {
      // The unique index is the real guard against two simultaneous registrations; translate its failure
      // into a domain exception so nothing above this layer ever sees a driver error code.
      if (isUniqueViolation(error, UNIQUE_USER_EMAIL)) throw new EmailAlreadyRegisteredException();
      throw error;
    }
  }
}
