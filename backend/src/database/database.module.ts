import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/configuration';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

const CONNECT_RETRY_ATTEMPTS = 5;
const CONNECT_RETRY_DELAY_MS = 2000;

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        type: 'postgres' as const,
        url: config.get('database', { infer: true }).url,
        entities: ENTITIES,
        migrations: MIGRATIONS,
        synchronize: false,
        migrationsRun: true,
        retryAttempts: CONNECT_RETRY_ATTEMPTS,
        retryDelay: CONNECT_RETRY_DELAY_MS,
        logging: ['warn', 'migration'],
      }),
    }),
  ],
})
export class DatabaseModule {}
