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

/** Thrown when an amount or currency is invalid. A programming/configuration error, never a user input error. */
export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

/**
 * An amount of money: a whole number of the currency's SMALLEST unit (cents, yen) plus the currency.
 *
 *  - Integers only. Floating point cannot represent 0.1 exactly, and the errors are real money.
 *  - Immutable: no method changes an existing Money.
 *  - Compared by value (`equals`), never by identity.
 *  - Cannot exist in an invalid state: the only ways to build one validate everything.
 *
 * This is also the provider contract: Stripe's `amount` is exactly `amountMinor`.
 */
export class Money {
  private constructor(
    readonly amountMinor: number,
    readonly currency: CurrencyCode,
  ) {
    Object.freeze(this);
  }

  /** From the smallest unit: `Money.of(4900, 'USD')` is 49.00 USD, `Money.of(4900, 'JPY')` is 4900 yen. */
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

  /**
   * From a decimal string such as "49.00" or "19.99", parsed digit by digit with NO floating point.
   * Refuses to round: "19.999 USD" is an error, not a silent 20.00.
   */
  static fromDecimalString(amount: string, currency: string): Money {
    const code = Money.parseCurrency(currency);
    const exponent = EXPONENT_BY_CURRENCY[code];

    const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
    if (!match) throw new InvalidMoneyError(`"${amount}" is not a plain decimal amount like 49.00`);

    const [, whole, fraction = ''] = match;
    if (fraction.length > exponent) {
      throw new InvalidMoneyError(`${code} has ${exponent} decimal places, but "${amount}" has ${fraction.length}`);
    }

    // BigInt so a huge input is detected instead of silently losing precision.
    const minor = BigInt(whole + fraction.padEnd(exponent, '0'));
    if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new InvalidMoneyError(`Amount "${amount}" is too large`);
    return Money.of(Number(minor), code);
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

  /** Number of decimal places of this currency (USD 2, JPY 0). */
  get exponent(): number {
    return EXPONENT_BY_CURRENCY[this.currency];
  }

  isPositive(): boolean {
    return this.amountMinor > 0;
  }

  equals(other: Money): boolean {
    return this.amountMinor === other.amountMinor && this.currency === other.currency;
  }

  /** "49.00" for USD, "4900" for JPY. Exact, built from the integer with string operations only. */
  toDecimalString(): string {
    if (this.exponent === 0) return String(this.amountMinor);
    const digits = String(this.amountMinor).padStart(this.exponent + 1, '0');
    return `${digits.slice(0, -this.exponent)}.${digits.slice(-this.exponent)}`;
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currency}`;
  }

  /** The shape used in API responses and persistence: minor units and currency, never a decimal. */
  toJSON(): { amountMinor: number; currency: CurrencyCode } {
    return { amountMinor: this.amountMinor, currency: this.currency };
  }
}
