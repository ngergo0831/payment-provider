import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../../common/database/pg-errors';
import { EmailAlreadyRegisteredException } from '../../common/errors/exceptions';
import { CompanyRepository } from '../application/ports';
import { Company } from '../domain/company.entity';
import { User } from '../domain/user.entity';

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

  async createWithAdmin(company: Company, admin: User): Promise<void> {
    try {
      await this.repository.manager.transaction(async (manager) => {
        await manager.insert(Company, company);
        await manager.insert(User, admin);
      });
    } catch (error) {
      if (isUniqueViolation(error, UNIQUE_USER_EMAIL)) throw new EmailAlreadyRegisteredException();
      throw error;
    }
  }
}
