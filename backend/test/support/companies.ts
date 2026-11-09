import type { TestApp } from './test-app';

export interface RegisteredCompany {
  companyId: string;
  auth: { Authorization: string };
}

let registrations = 0;

export async function registerCompany(t: TestApp): Promise<RegisteredCompany> {
  const res = await t.http
    .post('/auth/register')
    .send({ email: `admin${++registrations}@acme.example`, fullName: 'Jane', company: { name: 'Acme', country: 'HU' } })
    .expect(201);
  return { companyId: res.body.company.id as string, auth: { Authorization: `Bearer ${res.body.accessToken}` } };
}

export async function companyStatus(t: TestApp, company: RegisteredCompany): Promise<string> {
  return (await t.http.get('/onboarding/status').set(company.auth).expect(200)).body.company.status as string;
}

export async function waitForActivation(t: TestApp, company: RegisteredCompany, timeoutMs = 3000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let status = await companyStatus(t, company);
  while (status !== 'ACTIVE' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    status = await companyStatus(t, company);
  }
  return status;
}
