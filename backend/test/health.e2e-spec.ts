import { DataSource } from 'typeorm';
import { createTestApp, TestApp } from './support/test-app';

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

  it('answers 503 once the database connection is lost, and does not crash', async () => {
    const lost = await createTestApp();
    try {
      await lost.http.get('/health').expect(200);

      await lost.app.get(DataSource).destroy();

      const res = await lost.http.get('/health').expect(503);
      expect(res.body).toEqual({ status: 'error', database: 'down' });
    } finally {
      await lost.close();
    }
  });
});
