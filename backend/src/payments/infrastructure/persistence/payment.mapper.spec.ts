import { Money } from '../../domain/money';
import { Payment } from '../../domain/payment';
import { toDomain, toRecord } from './payment.mapper';

const T = new Date('2026-11-09T10:00:00Z');

describe('payment mapper (domain <-> table row)', () => {
  it('flattens Money into minor units and currency columns', () => {
    const record = toRecord(Payment.start({ companyId: 'c1', provider: 'stripe', amount: Money.of(4900, 'USD') }, T));
    expect(record).toMatchObject({
      companyId: 'c1',
      provider: 'stripe',
      amountMinor: 4900,
      currency: 'USD',
      status: 'CREATED',
      version: 0,
    });
  });

  it('refuses a stored row whose currency the domain does not support, instead of guessing', () => {
    const record = toRecord(Payment.start({ companyId: 'c', provider: 'mock', amount: Money.of(1, 'USD') }, T));
    record.currency = 'XXX';
    expect(() => toDomain(record)).toThrow(/Unsupported currency/);
  });
});
