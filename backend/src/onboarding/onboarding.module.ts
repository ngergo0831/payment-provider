import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountRepository, CompanyRepository, UserRepository } from './application/ports';
import { Company } from './domain/company.entity';
import { User } from './domain/user.entity';
import {
  TypeOrmAccountRepository,
  TypeOrmCompanyRepository,
  TypeOrmUserRepository,
} from './infrastructure/typeorm-repositories';

@Module({
  imports: [TypeOrmModule.forFeature([Company, User])],
  providers: [
    // The binding of port -> implementation. Swapping persistence means changing these three lines
    // (and writing the adapters), nothing in the application layer.
    { provide: CompanyRepository, useClass: TypeOrmCompanyRepository },
    { provide: UserRepository, useClass: TypeOrmUserRepository },
    { provide: AccountRepository, useClass: TypeOrmAccountRepository },
  ],
  exports: [CompanyRepository, UserRepository, AccountRepository],
})
export class OnboardingModule {}
