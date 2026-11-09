import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { GetOnboardingStatusUseCase } from './application/get-onboarding-status.use-case';
import { AccountRepository, CompanyRepository, UserRepository } from './application/ports';
import { RegisterCompanyAdminUseCase } from './application/register-company-admin.use-case';
import { Company } from './domain/company.entity';
import { User } from './domain/user.entity';
import {
  TypeOrmAccountRepository,
  TypeOrmCompanyRepository,
  TypeOrmUserRepository,
} from './infrastructure/typeorm-repositories';
import { OnboardingController } from './presentation/onboarding.controller';

@Module({
  // JwtAuthModule provides the guard for OnboardingController. It does not import onboarding, so there is no cycle.
  imports: [TypeOrmModule.forFeature([Company, User]), JwtAuthModule],
  controllers: [OnboardingController],
  providers: [
    RegisterCompanyAdminUseCase,
    GetOnboardingStatusUseCase,
    // The binding of port -> implementation. Swapping persistence means changing these three lines
    // (and writing the adapters), nothing in the application layer.
    { provide: CompanyRepository, useClass: TypeOrmCompanyRepository },
    { provide: UserRepository, useClass: TypeOrmUserRepository },
    { provide: AccountRepository, useClass: TypeOrmAccountRepository },
  ],
  exports: [RegisterCompanyAdminUseCase, CompanyRepository, UserRepository, AccountRepository],
})
export class OnboardingModule {}
