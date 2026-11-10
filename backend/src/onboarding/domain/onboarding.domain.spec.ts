import { Company } from './company.entity';
import { normalizeEmail } from './user.entity';

const newCompany = () => Company.register({ name: 'Acme Ltd', country: 'HU', taxId: 'HU12345678', billingEmail: 'billing@acme.example' });

describe('normalizeEmail', () => {
  it.each([
    ['Jane@Acme.Example', 'jane@acme.example'],
    ['  jane@acme.example  ', 'jane@acme.example'],
    ['\tJANE@ACME.EXAMPLE\n', 'jane@acme.example'],
    ['already@normal.example', 'already@normal.example'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it('is idempotent', () => {
    const once = normalizeEmail(' MiXeD@Case.EXAMPLE ');
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe('Company', () => {
  it('stores a missing tax id as null, not undefined', () => {
    const company = Company.register({ name: 'No Tax', country: 'DE', billingEmail: 'a@b.co' });
    expect(company.taxId).toBeNull();
  });

  it('activates, recording when', () => {
    const company = newCompany();
    const when = new Date('2026-11-09T12:00:00Z');

    company.activate(when);

    expect(company.isActive()).toBe(true);
    expect(company.activatedAt).toEqual(when);
  });

  it('activation is idempotent: a repeated success report does not move the activation time', () => {
    const company = newCompany();
    const first = new Date('2026-11-09T12:00:00Z');
    company.activate(first);

    company.activate(new Date('2026-11-10T08:00:00Z'));

    expect(company.activatedAt).toEqual(first);
  });
});
