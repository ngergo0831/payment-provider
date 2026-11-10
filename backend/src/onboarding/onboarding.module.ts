import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ActivateCompanyUseCase } from './application/activate-company.use-case';
import { GetOnboardingStatusUseCase } from './application/get-onboarding-status.use-case';
import { CompanyRepository } from './application/company.repository';
import { RegisterCompanyAdminUseCase } from './application/register-company-admin.use-case';
import { Company } from './domain/company.entity';
import { User } from './domain/user.entity';
import { TypeOrmCompanyRepository } from './infrastructure/typeorm-company.repository';
import { OnboardingController } from './presentation/onboarding.controller';
import { RegistrationController } from './presentation/registration.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Company, User]), AuthModule],
  controllers: [RegistrationController, OnboardingController],
  providers: [
    RegisterCompanyAdminUseCase,
    GetOnboardingStatusUseCase,
    ActivateCompanyUseCase,
    { provide: CompanyRepository, useClass: TypeOrmCompanyRepository },
  ],
  exports: [ActivateCompanyUseCase, CompanyRepository],
})
export class OnboardingModule {}
