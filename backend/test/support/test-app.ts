import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  databaseUrl: string;
  /** Closes the app AND drops its throw-away database. */
  close(): Promise<void>;
}

// Connects to the maintenance database `postgres` of the dev container from docker-compose.yml
// (the `payments` user is its superuser, so it may create databases).
const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://payments:payments@localhost:5432/postgres';

async function withAdminClient<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Cannot reach PostgreSQL for the e2e tests (${(error as Error).message}).\n` +
        'Start it first:  docker compose up -d   (from the repository root)',
    );
  }
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * Boots the REAL application (real modules, pipes, filter, TypeORM, migrations) against its own freshly
 * created database, so every test file starts from an empty schema and cannot disturb dev data or other files.
 */
export async function createTestApp(beforeInit?: (app: INestApplication) => void): Promise<TestApp> {
  const dbName = `e2e_${randomBytes(6).toString('hex')}`;
  await withAdminClient((client) => client.query(`CREATE DATABASE "${dbName}"`));

  const databaseUrl = new URL(ADMIN_URL);
  databaseUrl.pathname = `/${dbName}`;

  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: databaseUrl.toString() });

  // Imported only now: ConfigModule reads process.env the moment AppModule is first evaluated.
  const { AppModule } = await import('../../src/app.module');
  const { configureApp } = await import('../../src/app.setup');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  configureApp(app);
  // Routes and middleware must be attached BEFORE init(), exactly like main.ts does; afterwards they are ignored.
  beforeInit?.(app);
  await app.init();

  return {
    app,
    http: request(app.getHttpServer()),
    databaseUrl: databaseUrl.toString(),
    close: async () => {
      await app.close();
      // FORCE disconnects any straggling connection, so cleanup can never fail on a busy database.
      await withAdminClient((client) => client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`));
    },
  };
}

/** Runs a query on the test app's own database, bypassing the app (to inspect what really happened). */
export async function queryDatabase<Row = Record<string, unknown>>(databaseUrl: string, sql: string): Promise<Row[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query(sql)).rows as Row[];
  } finally {
    await client.end();
  }
}
