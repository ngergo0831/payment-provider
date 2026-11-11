import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, NETWORK_ERROR, SERVER_UNAVAILABLE, toApiError } from './client';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function mockFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('sends JSON to the /api prefix and returns the parsed body', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(201, { accessToken: 'tok' }));

    const result = await api.register({ email: 'a@b.co', fullName: 'Jane', company: { name: 'Acme', country: 'HU' } });

    expect(result).toEqual({ accessToken: 'tok' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/register');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('sends the bearer token when given one', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(200, {}));

    await api.onboardingStatus('my-token');

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer my-token' });
  });

  it("turns the backend's error envelope into an ApiError, with field messages for validation", async () => {
    mockFetch(async () =>
      jsonResponse(422, {
        statusCode: 422,
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: [{ field: 'company.name', messages: ['name must be longer than or equal to 2 characters', 'other'] }],
        requestId: 'req-1',
      }),
    );

    const error = await api.register({ email: 'x', fullName: 'x', company: { name: '', country: '' } }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_FAILED', requestId: 'req-1' });
    expect((error as ApiError).fieldMessages).toEqual({ 'company.name': 'name must be longer than or equal to 2 characters' });
  });

  it('reports an unreachable server as NETWORK_ERROR instead of leaking a TypeError', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(api.checkoutConfig()).rejects.toMatchObject({ code: NETWORK_ERROR, status: 0 });
  });

  it.each([502, 503, 504])('treats a proxy %i page (the API is down or restarting) as "service unavailable", not a generic error', async (status) => {
    mockFetch(async () => new Response('<html>Bad gateway</html>', { status }));

    const error = (await api.checkoutConfig().catch((e: unknown) => e)) as ApiError;

    expect(error).toMatchObject({ status, code: SERVER_UNAVAILABLE });
    expect(error.unreachable).toBe(true);
    expect(error.message).toContain('temporarily unavailable');
    expect(error.message).not.toContain('html');
  });

  it('counts a dropped connection as unreachable too', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    expect(((await api.checkoutConfig().catch((e: unknown) => e)) as ApiError).unreachable).toBe(true);
  });

  it("does NOT call the API's own 503 (payment provider down) unreachable: it has a real message and the API is fine", async () => {
    mockFetch(async () =>
      jsonResponse(503, { statusCode: 503, code: 'PAYMENT_PROVIDER_UNAVAILABLE', message: 'The payment service is temporarily unavailable. Nothing was charged.' }),
    );

    const error = (await api.startPayment('tok').catch((e: unknown) => e)) as ApiError;

    expect(error).toMatchObject({ code: 'PAYMENT_PROVIDER_UNAVAILABLE', unreachable: false });
    expect(error.message).toContain('Nothing was charged');
  });

  it('keeps a generic message for other non-JSON failures (a 500 page)', async () => {
    mockFetch(async () => new Response('<html>oops</html>', { status: 500 }));

    const error = (await api.checkoutConfig().catch((e: unknown) => e)) as ApiError;

    expect(error).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', unreachable: false });
    expect(error.message).not.toContain('html');
  });
});

describe('toApiError', () => {
  it('passes an ApiError through and wraps anything else in a generic one', () => {
    const known = new ApiError(409, 'EMAIL_ALREADY_REGISTERED', 'Taken');

    expect(toApiError(known)).toBe(known);
    expect(toApiError(new TypeError('boom'))).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' });
    expect(toApiError('a string')).toBeInstanceOf(ApiError);
  });
});
