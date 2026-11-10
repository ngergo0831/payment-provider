import { JwtService } from '@nestjs/jwt';
import { buildOpenApiDocument } from '../src/swagger.setup';
import { createTestApp, queryDatabase, TEST_JWT_SECRET, TestApp } from './support/test-app';

let counter = 0;
const registration = (name = 'Acme Ltd') => ({
  email: `user${++counter}@acme.example`,
  fullName: 'Jane Doe',
  company: { name, country: 'HU' },
});

const signer = new JwtService({ secret: TEST_JWT_SECRET });
const claims = (companyId: string) => ({ companyId });
const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('authentication and GET /onboarding/status (real HTTP + PostgreSQL)', () => {
  let t: TestApp;
  const status = (token?: string, scheme = 'Bearer') => {
    const request = t.http.get('/onboarding/status');
    return token ? request.set('Authorization', `${scheme} ${token}`) : request;
  };
  const register = async (name?: string) => {
    const res = await t.http.post('/auth/register').send(registration(name)).expect(201);
    return res.body as { accessToken: string; user: { id: string }; company: { id: string; name: string } };
  };

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  describe('registration hands back a working token', () => {
    it('returns a Bearer token with the configured lifetime that opens the status endpoint for the new company', async () => {
      const account = await register('Fresh Co');
      expect(account).toMatchObject({ tokenType: 'Bearer', accessToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/) });

      const { iat, exp } = signer.decode<{ iat: number; exp: number }>(account.accessToken);
      expect(exp - iat).toBe(24 * 3600); // the configured JWT_EXPIRES_IN

      const res = await status(account.accessToken).expect(200);
      expect(res.body).toEqual({
        company: { id: account.company.id, name: 'Fresh Co', status: 'PENDING_PAYMENT', activatedAt: null },
        nextStep: 'PAYMENT',
      });
    });

    it('says DONE for a company that is active', async () => {
      const account = await register();
      await queryDatabase(t.databaseUrl, `UPDATE companies SET status = 'ACTIVE', activated_at = now() WHERE id = '${account.company.id}'`);

      const res = await status(account.accessToken).expect(200);
      expect(res.body).toMatchObject({ company: { status: 'ACTIVE' }, nextStep: 'DONE' });
      expect(res.body.company.activatedAt).toEqual(expect.any(String));
    });
  });

  describe('requests without valid credentials get 401 in the standard error shape', () => {
    it('no Authorization header', async () => {
      const res = await status().expect(401);
      expect(res.body).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED', requestId: expect.any(String) });
    });

    it.each([
      ['garbage', 'not-a-jwt'],
      ['truncated', 'abc.def'],
      ['empty parts', '..'],
    ])('a %s token', async (_label, token) => {
      await status(token).expect(401);
    });

    it('the wrong scheme (Basic instead of Bearer)', async () => {
      const { accessToken } = await register();
      await status(accessToken, 'Basic').expect(401);
    });

    it('a token signed with a different secret (forged)', async () => {
      const { company } = await register();
      const forged = new JwtService({ secret: 'an-attackers-own-secret-of-32-chars!!!' }).sign(claims(company.id), {
        subject: 'u',
        issuer: 'payment-service',
      });
      await status(forged).expect(401);
    });

    it('an expired token', async () => {
      const { company } = await register();
      const expired = signer.sign(
        { ...claims(company.id), exp: Math.floor(Date.now() / 1000) - 60 },
        { subject: 'u', issuer: 'payment-service' }, // this signer has no default expiry, so `exp` above is the only one
      );
      await status(expired).expect(401);
    });

    it('a token from a different issuer, even though the secret is right', async () => {
      const { company } = await register();
      await status(signer.sign(claims(company.id), { subject: 'u', issuer: 'some-other-service' })).expect(401);
    });

    it('a token with no issuer at all', async () => {
      const { company } = await register();
      await status(signer.sign(claims(company.id), { subject: 'u' })).expect(401);
    });

    it('an UNSIGNED token (alg "none"): the classic JWT bypass', async () => {
      const { company } = await register();
      const unsigned = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
        ...claims(company.id),
        sub: 'u',
        iss: 'payment-service',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })}.`;
      await status(unsigned).expect(401);
    });

    it('a token signed with a different algorithm (HS384) using the right secret: the algorithm is pinned to HS256', async () => {
      const { company } = await register();
      const token = signer.sign(claims(company.id), { subject: 'u', issuer: 'payment-service', algorithm: 'HS384' });
      await status(token).expect(401);
    });

    it('a correctly signed token that lacks our claims', async () => {
      const token = signer.sign({ name: 'Jane' }, { subject: 'u', issuer: 'payment-service', expiresIn: '1h' });
      await status(token).expect(401);
    });
  });

  describe('tenant scoping: the company comes from the token and nowhere else', () => {
    it('each caller sees only their own company', async () => {
      const alice = await register('Alice Co');
      const bob = await register('Bob Co');

      expect((await status(alice.accessToken).expect(200)).body.company.name).toBe('Alice Co');
      expect((await status(bob.accessToken).expect(200)).body.company.name).toBe('Bob Co');
    });

    it('cannot be redirected to another company with a query parameter, header or body', async () => {
      const alice = await register('Alice Co');
      const bob = await register('Bob Co');

      const res = await t.http
        .get(`/onboarding/status?companyId=${bob.company.id}`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('x-company-id', bob.company.id)
        .expect(200);

      expect(res.body.company.id).toBe(alice.company.id);
    });

    it('answers 404 COMPANY_NOT_FOUND (not 500) when a valid token outlives its company', async () => {
      const ghost = signer.sign(claims('00000000-0000-4000-8000-000000000000'), {
        subject: 'u',
        issuer: 'payment-service',
        expiresIn: '1h',
      });
      const res = await status(ghost).expect(404);
      expect(res.body).toMatchObject({ code: 'COMPANY_NOT_FOUND', requestId: expect.any(String) });
    });
  });

  describe('documentation', () => {
    it('declares bearer auth, secures the status endpoint, and leaves registration open', () => {
      const doc = buildOpenApiDocument(t.app);

      expect(doc.components?.securitySchemes).toHaveProperty('bearer');
      const secured = doc.paths['/onboarding/status'].get as { security?: unknown[]; responses: Record<string, unknown> };
      expect(secured.security).toEqual([{ bearer: [] }]);
      expect(Object.keys(secured.responses)).toEqual(expect.arrayContaining(['200', '401', '404']));
      expect((doc.paths['/auth/register'].post as { security?: unknown }).security).toBeUndefined();
    });
  });
});
