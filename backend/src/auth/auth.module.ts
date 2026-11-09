import { Module } from '@nestjs/common';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { AuthController } from './presentation/auth.controller';

/** Entry points for "who is calling". Today only registration; tokens arrive in the next task. */
@Module({
  imports: [OnboardingModule],
  controllers: [AuthController],
})
export class AuthModule {}
