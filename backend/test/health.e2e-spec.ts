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

  it('applied the migrations at boot (the bookkeeping table records them)', async () => {
    const applied = await queryDatabase<{ name: string }>(t.databaseUrl, 'SELECT name FROM migrations ORDER BY id');
    expect(applied.map((row) => row.name)).toEqual(['CreateCompaniesAndUsers1794237392899']);
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
