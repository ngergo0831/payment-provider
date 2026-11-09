import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { AppLogger } from '../../src/common/logging/app-logger';
import { LogSink } from '../../src/common/logging/log-sink';

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  databaseUrl: string;
  /** Closes the app AND drops its throw-away database. */
  close(): Promise<void>;
}

/** Known to tests so they can mint tokens exactly like the app does (including deliberately flawed ones). */
export const TEST_JWT_SECRET = 'e2e-test-secret-that-is-at-least-32-chars';

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

export interface TestAppOptions {
  /** Runs before init(), e.g. to mount Swagger exactly like main.ts does. */
  beforeInit?: (app: INestApplication) => void;
  /** Environment overrides on top of the test defaults. */
  env?: Record<string, string>;
  /** Where log records go instead of the console, e.g. memory, to inspect them. The real AppLogger still filters and redacts. */
  logSink?: LogSink;
}

/**
 * Boots the REAL application (real modules, pipes, filter, TypeORM, migrations) against its own freshly
 * created database, so every test file starts from an empty schema and cannot disturb dev data or other files.
 */
export async function createTestApp({ beforeInit, env = {}, logSink }: TestAppOptions = {}): Promise<TestApp> {
  const dbName = `e2e_${randomBytes(6).toString('hex')}`;
  await withAdminClient((client) => client.query(`CREATE DATABASE "${dbName}"`));

  const databaseUrl = new URL(ADMIN_URL);
  databaseUrl.pathname = `/${dbName}`;

  // EVERY setting the app reads is stated here. The app also loads backend/.env, and real environment variables win over
  // it, so anything left out would silently come from the developer's own .env (e.g. their Stripe keys, which turned
  // the mock-provider tests into failures). A test that needs something else says so through `env`.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: databaseUrl.toString(),
    JWT_SECRET: TEST_JWT_SECRET,
    JWT_EXPIRES_IN: '24h',
    PLAN_PRICE_MINOR: '4900',
    PLAN_CURRENCY: 'USD',
    PAYMENT_PROVIDER: 'mock',
    STRIPE_SECRET_KEY: '',
    STRIPE_PUBLISHABLE_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    // No background timers in tests: they trigger delivery and reconciliation themselves, so results are deterministic.
    // Quiet by default: only errors reach the test output. A test that inspects logs raises it through `env`.
    LOG_LEVEL: 'error',
    LOG_FORMAT: 'text',
    OUTBOX_POLL_INTERVAL_MS: '0',
    RECONCILE_INTERVAL_MS: '0',
    ...env,
  });

  // FORCE disconnects any straggling connection, so cleanup can never fail on a busy database.
  const dropDatabase = () => withAdminClient((client) => client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`));

  let app: INestApplication | undefined;
  try {
    // Imported only now: ConfigModule reads process.env the moment AppModule is first evaluated.
    const { AppModule } = await import('../../src/app.module');
    const { configureApp } = await import('../../src/app.setup');

    const builder = Test.createTestingModule({ imports: [AppModule] });
    if (logSink) builder.overrideProvider(LogSink).useValue(logSink);
    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication({ rawBody: true, bufferLogs: true });
    app.useLogger(app.get(AppLogger)); // exactly like main.ts
    configureApp(app);
    // Routes and middleware must be attached BEFORE init(), exactly like main.ts does; afterwards they are ignored.
    beforeInit?.(app);
    await app.init();
  } catch (error) {
    // The app failed to boot (e.g. invalid configuration, which some tests check on purpose): do not leak the database.
    await app?.close().catch(() => undefined);
    await dropDatabase();
    throw error;
  }

  const booted = app;
  return {
    app: booted,
    http: request(booted.getHttpServer()),
    databaseUrl: databaseUrl.toString(),
    close: async () => {
      await booted.close();
      await dropDatabase();
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
