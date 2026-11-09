import { Module } from '@nestjs/common';
import { DatabaseHealthIndicator } from './database-health.indicator';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator],
})
export class HealthModule {}
