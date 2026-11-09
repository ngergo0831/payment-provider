import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

/** Root module. Feature modules (auth, onboarding, payments) are imported here as they are built. */
@Module({
  imports: [
    // isGlobal: any module can inject ConfigService without importing ConfigModule again.
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    DatabaseModule,
    HealthModule,
  ],
})
export class AppModule {}
