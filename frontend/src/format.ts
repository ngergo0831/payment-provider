import type { Money } from './api/types';

/** 4900 USD -> "$49.00", 4900 JPY -> "¥4,900". The currency decides how many decimals the minor unit has. */
export function formatMoney({ amountMinor, currency }: Money, locale?: string): string {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const decimals = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountMinor / 10 ** decimals);
}
