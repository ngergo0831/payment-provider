import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { logRequests } from './access-log';

function run(request: { method: string; path: string; user?: { companyId: string } }, statusCode: number) {
  const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  const res = Object.assign(new EventEmitter(), { statusCode }) as unknown as Response;
  const next = jest.fn();

  logRequests({ id: 'req-1', ...request } as unknown as Request, res, next);
  res.emit('finish');

  expect(next).toHaveBeenCalledTimes(1);
  return { log: log.mock.calls.map(([line]) => String(line)), debug: debug.mock.calls.map(([line]) => String(line)) };
}

afterEach(() => jest.restoreAllMocks());

describe('logRequests', () => {
  it('writes one line with the request id, method, path, status, duration and company', () => {
    const { log } = run({ method: 'POST', path: '/payments', user: { companyId: 'company-1' } }, 200);

    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^\[req-1\] POST \/payments -> 200 \d+ms company=company-1$/);
  });

  it('leaves the company out on routes without a signed-in user', () => {
    const { log } = run({ method: 'POST', path: '/auth/register' }, 201);

    expect(log[0]).toMatch(/^\[req-1\] POST \/auth\/register -> 201 \d+ms$/);
  });

  it('logs successful reads at debug (the activation polling), so LOG_LEVEL=log silences them', () => {
    const { log, debug } = run({ method: 'GET', path: '/onboarding/status' }, 200);

    expect(log).toEqual([]);
    expect(debug).toHaveLength(1);
  });

  it.each([
    ['a failed read', 'GET', 404],
    ['a successful change', 'POST', 200],
    ['a failed change', 'POST', 422],
  ])('logs %s at the normal level', (_label, method, status) => {
    const { log, debug } = run({ method, path: '/payments/p1' }, status);

    expect(log).toHaveLength(1);
    expect(debug).toEqual([]);
  });

  it('cuts a very long path, so one request cannot write a megabyte into the log', () => {
    const { log } = run({ method: 'GET', path: `/${'a'.repeat(5000)}` }, 404);

    expect(log[0].length).toBeLessThan(300);
    expect(log[0]).toContain('…');
  });

  it('does not log health probes', () => {
    const { log, debug } = run({ method: 'GET', path: '/health' }, 200);

    expect([...log, ...debug]).toEqual([]);
  });

  it('logs the path only: a query string can carry personal data', () => {
    const { log } = run({ method: 'GET', path: '/payments/p1' }, 500);

    expect(log[0]).not.toContain('?');
  });
});
