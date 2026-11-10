import { InvalidMoneyError, Money } from './money';

describe('Money.of (from minor units)', () => {
  it('holds an integer amount and a normalised currency', () => {
    const money = Money.of(4900, 'usd');
    expect(money).toMatchObject({ amountMinor: 4900, currency: 'USD' });
  });

  it.each([
    ['a fraction', 49.5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['a negative amount', -1],
  ])('rejects %s', (_label, amount) => {
    expect(() => Money.of(amount, 'USD')).toThrow(InvalidMoneyError);
  });

  it('allows zero (it is a valid amount; whether a payment may be zero is a payment rule)', () => {
    expect(Money.of(0, 'USD').isPositive()).toBe(false);
    expect(Money.of(1, 'USD').isPositive()).toBe(true);
  });

  it.each(['', 'US', 'USDX', 'XXX', 'BTC', 'HUF', 'KWD', '123'])('rejects the unsupported currency %j rather than guessing', (currency) => {
    expect(() => Money.of(100, currency)).toThrow(/Unsupported currency/);
  });

  it('lists the supported currencies in the error, so the fix is obvious', () => {
    expect(() => Money.of(100, 'BTC')).toThrow(/Supported: USD, EUR/);
  });
});

describe('currency decimals', () => {
  it('USD has 2 decimals: 4900 minor units is 49.00', () => {
    expect(Money.of(4900, 'USD').toDecimalString()).toBe('49.00');
    expect(Money.of(4900, 'USD').exponent).toBe(2);
  });

  it('JPY has 0 decimals: 4900 minor units is 4900 yen, NOT 49 (a hardcoded /100 would be a 100x error)', () => {
    expect(Money.of(4900, 'JPY').toDecimalString()).toBe('4900');
    expect(Money.of(4900, 'JPY').exponent).toBe(0);
  });
});

describe('value semantics', () => {
  it('is equal by value, and different currency or amount means different money', () => {
    expect(Money.of(4900, 'USD').equals(Money.of(4900, 'usd'))).toBe(true);
    expect(Money.of(4900, 'USD').equals(Money.of(4901, 'USD'))).toBe(false);
    expect(Money.of(4900, 'USD').equals(Money.of(4900, 'EUR'))).toBe(false);
  });

  it('is immutable', () => {
    const money = Money.of(4900, 'USD');
    expect(Object.isFrozen(money)).toBe(true);
    expect(() => {
      (money as { amountMinor: number }).amountMinor = 1;
    }).toThrow(TypeError);    expect(money.amountMinor).toBe(4900);
  });

  it('prints readably and serialises as minor units, never as a decimal', () => {
    expect(String(Money.of(4900, 'USD'))).toBe('49.00 USD');
    expect(String(Money.of(4900, 'JPY'))).toBe('4900 JPY');
    expect(JSON.stringify({ price: Money.of(4900, 'USD') })).toBe('{"price":{"amountMinor":4900,"currency":"USD"}}');
  });

  it('formats small amounts with leading zeros: 5 cents is 0.05, not .5 or 0.5', () => {
    expect(Money.of(5, 'USD').toDecimalString()).toBe('0.05');
    expect(Money.of(50, 'USD').toDecimalString()).toBe('0.50');
    expect(Money.of(0, 'USD').toDecimalString()).toBe('0.00');
  });
});
