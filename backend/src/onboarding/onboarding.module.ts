import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountRepository, CompanyRepository, UserRepository } from './application/ports';
import { RegisterCompanyAdminUseCase } from './application/register-company-admin.use-case';
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
    RegisterCompanyAdminUseCase,
    // The binding of port -> implementation. Swapping persistence means changing these three lines
    // (and writing the adapters), nothing in the application layer.
    { provide: CompanyRepository, useClass: TypeOrmCompanyRepository },
    { provide: UserRepository, useClass: TypeOrmUserRepository },
    { provide: AccountRepository, useClass: TypeOrmAccountRepository },
  ],
  exports: [RegisterCompanyAdminUseCase, CompanyRepository, UserRepository, AccountRepository],
})
export class OnboardingModule {}
