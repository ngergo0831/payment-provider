import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';

/** Root module. Feature modules (auth, onboarding, payments) are imported here as they are built. */
@Module({
  controllers: [HealthController],
})
export class AppModule {}
