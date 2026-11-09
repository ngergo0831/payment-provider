import { DataSource } from 'typeorm';
import { createTestApp, queryDatabase, TestApp } from './support/test-app';

describe('database connection and /health (real PostgreSQL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('reports the database as up', async () => {
    const res = await t.http.get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('created only the migrations bookkeeping table: the schema comes from migrations, never from entities', async () => {
    // `synchronize` is off. If it were on, TypeORM would create tables for every entity at boot.
    const tables = await queryDatabase<{ table_name: string }>(
      t.databaseUrl,
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(tables.map((row) => row.table_name)).toEqual(['migrations']);
  });

  it('answers 503 once the database connection is lost, and does not crash', async () => {
    const lost = await createTestApp(); // its own app, so closing its connection disturbs nobody else
    try {
      await lost.http.get('/health').expect(200);

      await lost.app.get(DataSource).destroy(); // simulate losing the database

      const res = await lost.http.get('/health').expect(503);
      expect(res.body).toEqual({ status: 'error', database: 'down' });
    } finally {
      await lost.close();
    }
  });
});
