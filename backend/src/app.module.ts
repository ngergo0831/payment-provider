import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { LoggingModule } from './common/logging/logging.module';
import { configuration } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PaymentsModule } from './payments/payments.module';

/** Root module. Feature modules (auth, onboarding, payments) are imported here as they are built. */
@Module({
  imports: [
    // isGlobal: any module can inject ConfigService without importing ConfigModule again.
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    LoggingModule,
    DatabaseModule,
    HealthModule,
    OnboardingModule,
    AuthModule,
    PaymentsModule,
  ],
})
export class AppModule {}
