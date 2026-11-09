import { buildOpenApiDocument } from '../src/swagger.setup';
import { createTestApp, queryDatabase, TestApp } from './support/test-app';

let counter = 0;
const payload = (overrides: Record<string, unknown> = {}) => ({
  email: `jane${++counter}@acme.example`,
  fullName: 'Jane Doe',
  company: { name: 'Acme Ltd', country: 'HU', taxId: 'HU12345678' },
  ...overrides,
});

describe('POST /auth/register (real HTTP + PostgreSQL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  describe('success', () => {
    it('answers 201 with the new user and a company that is PENDING_PAYMENT', async () => {
      const body = payload();
      const res = await t.http.post('/auth/register').send(body).expect(201);

      expect(res.body).toEqual({
        user: { id: expect.any(String), email: body.email, fullName: 'Jane Doe', role: 'ADMIN' },
        company: { id: expect.any(String), name: 'Acme Ltd', status: 'PENDING_PAYMENT' },
      });
    });

    it('really stored both rows, linked together', async () => {
      const body = payload();
      const res = await t.http.post('/auth/register').send(body).expect(201);

      const rows = await queryDatabase<{ company_id: string; status: string; billing_email: string; tax_id: string }>(
        t.databaseUrl,
        `SELECT u.company_id, c.status, c.billing_email, c.tax_id FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = '${res.body.user.id}'`,
      );
      expect(rows).toEqual([
        { company_id: res.body.company.id, status: 'PENDING_PAYMENT', billing_email: body.email, tax_id: 'HU12345678' },
      ]);
    });

    it('exposes nothing beyond the documented fields', async () => {
      const res = await t.http.post('/auth/register').send(payload()).expect(201);
      expect(Object.keys(res.body.user).sort()).toEqual(['email', 'fullName', 'id', 'role']);
      expect(Object.keys(res.body.company).sort()).toEqual(['id', 'name', 'status']);
    });

    it('cleans the input: trims, lower-cases the email, upper-cases the country', async () => {
      const email = `Mixed${++counter}@Acme.EXAMPLE`;
      const res = await t.http
        .post('/auth/register')
        .send({ email: `  ${email}  `, fullName: '  Jane  ', company: { name: ' Acme ', country: 'hu' } })
        .expect(201);

      expect(res.body.user.email).toBe(email.toLowerCase());
      expect(res.body.user.fullName).toBe('Jane');
      expect(res.body.company.name).toBe('Acme');
      const [{ country }] = await queryDatabase<{ country: string }>(
        t.databaseUrl,
        `SELECT country FROM companies WHERE id = '${res.body.company.id}'`,
      );
      expect(country).toBe('HU');
    });

    it('uses an explicit billing email when given', async () => {
      const res = await t.http
        .post('/auth/register')
        .send(payload({ company: { name: 'Acme', country: 'DE', billingEmail: 'Billing@Acme.example' } }))
        .expect(201);

      const [{ billing_email }] = await queryDatabase<{ billing_email: string }>(
        t.databaseUrl,
        `SELECT billing_email FROM companies WHERE id = '${res.body.company.id}'`,
      );
      expect(billing_email).toBe('billing@acme.example');
    });
  });

  describe('invalid input (422, nothing stored)', () => {
    it('lists every bad field at once, including nested ones', async () => {
      const res = await t.http
        .post('/auth/register')
        .send({ email: 'not-an-email', fullName: 'J', company: { name: 'A', country: 'ZZ' } })
        .expect(422);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      const fields = res.body.details.map((d: { field: string }) => d.field).sort();
      expect(fields).toEqual(['company.country', 'company.name', 'email', 'fullName']);
    });

    it('rejects missing required fields', async () => {
      const res = await t.http.post('/auth/register').send({}).expect(422);
      const fields = res.body.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(expect.arrayContaining(['email', 'fullName', 'company']));
    });

    it('answers 422, not a 500 crash, when the company object is missing or not an object', async () => {
      for (const company of [undefined, null, 'Acme', 42, []]) {
        const res = await t.http.post('/auth/register').send({ email: `x${++counter}@acme.example`, fullName: 'Jane', company });
        expect({ company, status: res.status }).toEqual({ company, status: 422 });
      }
    });

    it('rejects unknown fields rather than ignoring them (no smuggling a role in)', async () => {
      const res = await t.http.post('/auth/register').send({ ...payload(), role: 'ADMIN', status: 'ACTIVE' }).expect(422);
      const fields = res.body.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(expect.arrayContaining(['role', 'status']));
    });

    it('cannot register an already-ACTIVE company by sending a status', async () => {
      const body = payload({ company: { name: 'Sneaky', country: 'HU', status: 'ACTIVE' } });
      await t.http.post('/auth/register').send(body).expect(422);
      const rows = await queryDatabase(t.databaseUrl, "SELECT 1 FROM companies WHERE name = 'Sneaky'");
      expect(rows).toHaveLength(0);
    });

    it('stores nothing when validation fails', async () => {
      const email = `invalid${++counter}@acme.example`;
      await t.http.post('/auth/register').send({ email, fullName: '', company: { name: 'Acme', country: 'HU' } }).expect(422);
      expect(await queryDatabase(t.databaseUrl, `SELECT 1 FROM users WHERE email = '${email}'`)).toHaveLength(0);
    });
  });

  describe('duplicate email (409)', () => {
    it('is refused with a stable code, ignoring case, and creates no second company', async () => {
      const body = payload();
      await t.http.post('/auth/register').send(body).expect(201);

      const res = await t.http.post('/auth/register').send({ ...body, email: body.email.toUpperCase() }).expect(409);

      expect(res.body).toMatchObject({ statusCode: 409, code: 'EMAIL_ALREADY_REGISTERED', requestId: expect.any(String) });
      const companies = await queryDatabase(t.databaseUrl, `SELECT 1 FROM users WHERE email = '${body.email}'`);
      expect(companies).toHaveLength(1);
    });

    it('lets exactly ONE of five simultaneous registrations win, and leaves no orphan companies', async () => {
      const body = payload({ company: { name: 'RaceCo', country: 'HU' } });

      const responses = await Promise.all(Array.from({ length: 5 }, () => t.http.post('/auth/register').send(body)));

      expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
      expect(await queryDatabase(t.databaseUrl, `SELECT 1 FROM users WHERE email = '${body.email}'`)).toHaveLength(1);
      expect(await queryDatabase(t.databaseUrl, "SELECT 1 FROM companies WHERE name = 'RaceCo'")).toHaveLength(1);
    });
  });

  describe('documentation', () => {
    it('is documented with a pre-filled example and its 201 / 409 / 422 outcomes', () => {
      const doc = buildOpenApiDocument(t.app);
      const operation = doc.paths['/auth/register'].post as { responses: Record<string, unknown>; tags: string[] };
      expect(Object.keys(operation.responses)).toEqual(expect.arrayContaining(['201', '409', '422']));

      const schemas = doc.components?.schemas as Record<string, { properties: Record<string, { example?: unknown }> }>;
      expect(schemas.RegisterDto.properties.email.example).toBe('jane.doe@acme.example');
      expect(schemas.CompanyDetailsDto.properties.country.example).toBe('HU');
    });
  });
});
