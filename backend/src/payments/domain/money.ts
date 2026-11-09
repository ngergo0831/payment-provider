/**
 * How many decimal places each supported currency has (ISO 4217 "minor unit" exponent).
 * 1 USD = 100 cents (exponent 2), but 1 JPY has no sub-unit (exponent 0).
 *
 * The list is EXPLICIT, and an unknown currency is rejected rather than guessed: guessing wrong
 * means charging 100x too much or too little. Deliberately NOT supported yet:
 *  - HUF, TWD, UGX: two-decimal in ISO, but Stripe only accepts whole units (amount divisible by 100).
 *  - KWD, BHD, JOD, OMR, TND: three decimals, and Stripe wants the last digit to be 0.
 * Each needs its own rule before it can be added safely.
 */
const EXPONENT_BY_CURRENCY = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  CAD: 2,
  AUD: 2,
  PLN: 2,
  CZK: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  JPY: 0,
  KRW: 0,
} as const;

export type CurrencyCode = keyof typeof EXPONENT_BY_CURRENCY;

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class Money {
  private constructor(
    readonly amountMinor: number,
    readonly currency: CurrencyCode,
  ) {
    Object.freeze(this);
  }

  static of(amountMinor: number, currency: string): Money {
    const code = Money.parseCurrency(currency);
    if (!Number.isSafeInteger(amountMinor)) {
      throw new InvalidMoneyError(`Amount must be a whole number of minor units, got ${String(amountMinor)}`);
    }
    if (amountMinor < 0) {
      throw new InvalidMoneyError(`Amount must not be negative, got ${amountMinor}`);
    }
    return new Money(amountMinor, code);
  }

  static supportedCurrencies(): readonly CurrencyCode[] {
    return Object.keys(EXPONENT_BY_CURRENCY) as CurrencyCode[];
  }

  private static parseCurrency(currency: string): CurrencyCode {
    const code = currency.trim().toUpperCase();
    if (!(code in EXPONENT_BY_CURRENCY)) {
      throw new InvalidMoneyError(`Unsupported currency "${currency}". Supported: ${Money.supportedCurrencies().join(', ')}`);
    }
    return code as CurrencyCode;
  }

  get exponent(): number {
    return EXPONENT_BY_CURRENCY[this.currency];
  }

  isPositive(): boolean {
    return this.amountMinor > 0;
  }

  equals(other: Money): boolean {
    return this.amountMinor === other.amountMinor && this.currency === other.currency;
  }

  toDecimalString(): string {
    if (this.exponent === 0) return String(this.amountMinor);
    const digits = String(this.amountMinor).padStart(this.exponent + 1, '0');
    return `${digits.slice(0, -this.exponent)}.${digits.slice(-this.exponent)}`;
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currency}`;
  }

  toJSON(): { amountMinor: number; currency: CurrencyCode } {
    return { amountMinor: this.amountMinor, currency: this.currency };
  }
}
