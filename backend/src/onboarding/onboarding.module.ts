import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { ActivateCompanyUseCase } from './application/activate-company.use-case';
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
  imports: [TypeOrmModule.forFeature([Company, User]), JwtAuthModule],
  controllers: [OnboardingController],
  providers: [
    RegisterCompanyAdminUseCase,
    GetOnboardingStatusUseCase,
    ActivateCompanyUseCase,
    { provide: CompanyRepository, useClass: TypeOrmCompanyRepository },
    { provide: UserRepository, useClass: TypeOrmUserRepository },
    { provide: AccountRepository, useClass: TypeOrmAccountRepository },
  ],
  exports: [RegisterCompanyAdminUseCase, ActivateCompanyUseCase, CompanyRepository],
})
export class OnboardingModule {}
