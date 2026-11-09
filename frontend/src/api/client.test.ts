import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, NETWORK_ERROR } from './client';

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

  it('survives a non-JSON error page (a proxy returning 502) with a generic message', async () => {
    mockFetch(async () => new Response('<html>Bad gateway</html>', { status: 502 }));

    const error = await api.checkoutConfig().catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 502, code: 'INTERNAL_ERROR' });
    expect((error as ApiError).message).not.toContain('html');
  });
});
