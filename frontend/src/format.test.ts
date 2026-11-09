import { describe, expect, it } from 'vitest';
import { formatMoney } from './format';

describe('formatMoney', () => {
  it('shows cents for two-decimal currencies', () => {
    expect(formatMoney({ amountMinor: 4900, currency: 'USD' }, 'en-US')).toBe('$49.00');
    expect(formatMoney({ amountMinor: 1999, currency: 'EUR' }, 'en-US')).toBe('€19.99');
  });

  it('does not divide whole-unit currencies (JPY has no minor unit)', () => {
    expect(formatMoney({ amountMinor: 4900, currency: 'JPY' }, 'en-US')).toBe('¥4,900');
  });
});
