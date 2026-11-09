import { jest } from '@jest/globals';
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DatabaseHealthIndicator } from './database-health.indicator';
import { HealthController } from './health.controller';

/** A stand-in for the database: tests decide how `query` behaves. */
const fakeDataSource = (query: () => Promise<unknown>) => ({ query: jest.fn(query) }) as unknown as DataSource;

describe('DatabaseHealthIndicator', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('is up when the query succeeds', async () => {
    const indicator = new DatabaseHealthIndicator(fakeDataSource(async () => [{ '?column?': 1 }]));
    await expect(indicator.isUp()).resolves.toBe(true);
  });

  it('is down, without throwing, when the query fails', async () => {
    const indicator = new DatabaseHealthIndicator(
      fakeDataSource(async () => {
        throw new Error('connection refused');
      }),
    );
    await expect(indicator.isUp()).resolves.toBe(false);
  });

  it('logs something useful even when the error has an empty message (common for connection errors)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const emptyMessage = Object.assign(new Error(''), { code: 'ECONNREFUSED' });
    const indicator = new DatabaseHealthIndicator(fakeDataSource(async () => Promise.reject(emptyMessage)));

    await indicator.isUp();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });

  it('is down when the database accepts the connection but never answers (timeout)', async () => {
    const neverAnswers = () => new Promise<never>(() => undefined);
    const indicator = new DatabaseHealthIndicator(fakeDataSource(neverAnswers));

    const started = Date.now();
    await expect(indicator.isUp(50)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1000); // returned after ~50 ms, did not hang
  });
});

describe('GET /health', () => {
  let app: INestApplication;
  let query: jest.Mock<() => Promise<unknown>>;

  beforeAll(async () => {
    query = jest.fn(async () => [{ '?column?': 1 }]);
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [DatabaseHealthIndicator, { provide: DataSource, useValue: { query } }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => app.close());

  it('answers 200 when the database is up', async () => {
    query.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('answers 503 (a STATUS CODE, which orchestrators act on) when the database is down', async () => {
    query.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.body).toEqual({ status: 'error', database: 'down' });
  });

  it('does not leak the underlying database error to the caller', async () => {
    query.mockRejectedValueOnce(new Error('password authentication failed for user "payments" at 10.0.0.5'));
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(JSON.stringify(res.body)).not.toMatch(/password|10\.0\.0\.5|payments/);
  });
});
