import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfig, configuration } from './config/configuration';
import { PaymentProviderName } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { MockPaymentsDevModule } from './payments/mock-payments-dev.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => [{ ttl: 60_000, limit: config.get('rateLimitPerMinute', { infer: true }) }],
    }),
    DatabaseModule,
    HealthModule,
    OnboardingModule,
    PaymentsModule,
    ConditionalModule.registerWhen(MockPaymentsDevModule, (env) => env.PAYMENT_PROVIDER === PaymentProviderName.Mock),
  ],
})
export class AppModule {}
