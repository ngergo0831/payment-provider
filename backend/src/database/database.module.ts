import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/configuration';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

// If the database is unreachable at boot, retry briefly (it may still be starting) and then EXIT with an
// error. The default is 9 attempts x 3 s, which makes a misconfigured deploy look like a hung process.
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

        // The schema is owned by migrations ONLY. `synchronize` rewrites tables to match the entities at
        // every boot and can silently drop a column (and its data). Unacceptable for payment records.
        synchronize: false,

        // Apply pending migrations at startup, so `docker compose up` yields a ready schema.
        // Fine for one instance; with several replicas, run migrations as a separate release step.
        migrationsRun: true,

        retryAttempts: CONNECT_RETRY_ATTEMPTS,
        retryDelay: CONNECT_RETRY_DELAY_MS,

        // NO 'error' here, on purpose. TypeORM's error logging prints the failed query WITH ITS PARAMETER VALUES, i.e.
        // customer emails, names and payment details, straight into the logs. The failure itself is not lost: it is thrown
        // as an exception and logged by the global exception filter (message and stack, without the parameters).
        // 'query' is never enabled either, for the same reason.
        logging: ['warn', 'migration'],
      }),
    }),
  ],
})
export class DatabaseModule {}
