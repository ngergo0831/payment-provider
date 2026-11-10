import { Money } from '../../domain/money';
import { Payment } from '../../domain/payment';
import { PaymentStatus } from '../../domain/payment-status';
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

  it('round-trips every field, including a failed, linked and synced payment', () => {
    const payment = Payment.start({ companyId: 'c1', provider: 'stripe', amount: Money.of(4900, 'JPY') }, T);
    payment.attachProviderRef('pi_1', T);
    payment.applyStatus(PaymentStatus.FAILED, 'card_declined', T);
    payment.markSynced(T);

    expect(toDomain(toRecord(payment)).toSnapshot()).toEqual(payment.toSnapshot());
  });

  it('rebuilds Money with the right currency rules: yen stay whole', () => {
    const payment = Payment.start({ companyId: 'c', provider: 'mock', amount: Money.of(4900, 'JPY') }, T);
    expect(toDomain(toRecord(payment)).amount.toDecimalString()).toBe('4900');
  });

  it('carries the version through unchanged (persistence owns it)', () => {
    const snapshot = { ...Payment.start({ companyId: 'c', provider: 'mock', amount: Money.of(1, 'USD') }, T).toSnapshot(), version: 7 };
    expect(toRecord(Payment.restore(snapshot)).version).toBe(7);
    expect(toDomain(toRecord(Payment.restore(snapshot))).version).toBe(7);
  });

  it('refuses a stored row whose currency the domain does not support, instead of guessing', () => {
    const record = toRecord(Payment.start({ companyId: 'c', provider: 'mock', amount: Money.of(1, 'USD') }, T));
    record.currency = 'XXX';
    expect(() => toDomain(record)).toThrow(/Unsupported currency/);
  });
});
