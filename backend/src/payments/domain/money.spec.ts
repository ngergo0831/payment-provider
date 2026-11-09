import { InvalidMoneyError, Money } from './money';

describe('why Money exists: floating point loses cents', () => {
  it('the naive conversion is WRONG for ordinary prices (this is the bug Money prevents)', () => {
    expect(19.99 * 100).not.toBe(1999); // 1998.9999999999998
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(Math.round(1.005 * 100)).toBe(100); // "1.005" rounds to 1.00, and a cent has silently vanished
  });

  it('Money gets it exactly right, with no floating point involved', () => {
    expect(Money.fromDecimalString('19.99', 'USD').amountMinor).toBe(1999);
    expect(Money.fromDecimalString('0.29', 'USD').amountMinor).toBe(29); // 0.29 * 100 is 28.999999999999996 in floats
    expect(Money.fromDecimalString('1.10', 'USD').amountMinor).toBe(110); // 1.1 * 100 is 110.00000000000001
  });
});

describe('large amounts keep every digit', () => {
  // Found by brute-force search: for these amounts, `Math.round(parseFloat(text) * 100)` returns a DIFFERENT
  // number, because a double holds only ~15-17 significant digits. All are inside the valid range.
  it.each([
    ['39013103017373.13', 3901310301737313],
    ['78457793824192.07', 7845779382419207],
    ['83349160059196.18', 8334916005919618],
  ])('%s USD is exactly %d minor units (a float-based parser gets this wrong)', (text, expectedMinor) => {
    expect(Math.round(parseFloat(text) * 100)).not.toBe(expectedMinor); // proves the trap is real
    expect(Money.fromDecimalString(text, 'USD').amountMinor).toBe(expectedMinor);
  });
});

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

  it('is the same instruction for the provider: the minor-unit integer is what gets sent, whatever the currency', () => {
    expect(Money.fromDecimalString('49', 'JPY').amountMinor).toBe(49);
    expect(Money.fromDecimalString('49.00', 'USD').amountMinor).toBe(4900);
  });
});

describe('Money.fromDecimalString', () => {
  it.each([
    ['49.00', 'USD', 4900],
    ['49', 'USD', 4900],
    ['49.5', 'USD', 4950],
    ['0.05', 'USD', 5],
    ['0', 'USD', 0],
    ['007.50', 'USD', 750],
    ['  19.99  ', 'EUR', 1999],
    ['4900', 'JPY', 4900],
    ['90071992547409.91', 'USD', 9007199254740991],
  ])('%j %s -> %d minor units', (text, currency, expected) => {
    expect(Money.fromDecimalString(text, currency).amountMinor).toBe(expected);
  });

  it.each([
    ['too many decimals for the currency (no silent rounding)', '19.999', 'USD'],
    ['decimals on a zero-decimal currency', '49.5', 'JPY'],
    ['even ".0" on a zero-decimal currency', '49.0', 'JPY'],
    ['a negative number', '-5.00', 'USD'],
    ['a comma decimal separator', '49,00', 'USD'],
    ['a thousands separator', '1,000.00', 'USD'],
    ['a currency symbol', '$49.00', 'USD'],
    ['scientific notation', '4.9e1', 'USD'],
    ['empty text', '', 'USD'],
    ['text', 'forty-nine', 'USD'],
    ['a trailing dot', '49.', 'USD'],
    ['a leading dot', '.99', 'USD'],
    ['an amount beyond the safe integer range', '90071992547409.92', 'USD'],
  ])('rejects %s', (_label, text, currency) => {
    expect(() => Money.fromDecimalString(text, currency)).toThrow(InvalidMoneyError);
  });

  it('round-trips: formatting then parsing gives back the same amount, for every currency and a wide range of amounts', () => {
    const samples = [...Array.from({ length: 1500 }, (_, i) => i), 9_999, 100_000, 123_456_789, 9_007_199_254_740_991];
    for (const currency of Money.supportedCurrencies()) {
      for (const minor of samples) {
        const original = Money.of(minor, currency);
        const parsed = Money.fromDecimalString(original.toDecimalString(), currency);
        expect(parsed.equals(original)).toBe(true);
      }
    }
  });
});

describe('value semantics', () => {
  it('is equal by value, and different currency or amount means different money', () => {
    expect(Money.of(4900, 'USD').equals(Money.of(4900, 'usd'))).toBe(true);
    expect(Money.of(4900, 'USD').equals(Money.of(4901, 'USD'))).toBe(false);
    expect(Money.of(4900, 'USD').equals(Money.of(4900, 'EUR'))).toBe(false); // 49 dollars is not 49 euros
  });

  it('is immutable', () => {
    const money = Money.of(4900, 'USD');
    expect(Object.isFrozen(money)).toBe(true);
    expect(() => {
      (money as { amountMinor: number }).amountMinor = 1;
    }).toThrow(TypeError); // strict mode (modules): assignment to a frozen object throws
    expect(money.amountMinor).toBe(4900);
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
