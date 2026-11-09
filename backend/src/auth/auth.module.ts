import { Module } from '@nestjs/common';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { JwtAuthModule } from './jwt-auth.module';
import { AuthController } from './presentation/auth.controller';

/** Entry points for "who is calling": today, registration (which hands back a token). */
@Module({
  imports: [OnboardingModule, JwtAuthModule],
  controllers: [AuthController],
})
export class AuthModule {}
