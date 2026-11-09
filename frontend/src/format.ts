import type { Money } from './api/types';

export function formatMoney({ amountMinor, currency }: Money, locale?: string): string {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const decimals = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountMinor / 10 ** decimals);
}
