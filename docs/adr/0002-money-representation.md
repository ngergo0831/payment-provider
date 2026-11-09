# ADR 0002: How money is represented

- **Status:** accepted (task 11)
- **Context:** the system charges real money. A wrong amount is the most expensive bug this service can have, and the two
  common mistakes (floating point, assuming two decimals) are easy to make and invisible in a demo.

## Decision

Every amount in payment code is a `Money` value object (`payments/domain/money.ts`):

1. **Integer minor units only** (cents, yen). Never a float, never a decimal string in storage or in the provider call.
   This is also exactly what Stripe expects for `amount`.
2. **Currency-aware decimals.** An explicit table gives each currency its decimal places (USD 2, JPY 0).
3. **An explicit list of supported currencies.** An unknown currency is rejected, not guessed. HUF/TWD/UGX (Stripe accepts
   only whole units) and three-decimal currencies (KWD, BHD, ...) are deliberately excluded until each has its own rule.
4. **Strict parsing, no rounding.** `"19.999"` for USD is an error. Parsing is digit by digit (BigInt), with no floating point.
5. **Immutable and valid by construction.** There is no way to hold a `Money` that is fractional, NaN, negative or unsafe.
6. **Currency is stored upper-case** (ISO 4217). The Stripe adapter lowercases it at the boundary.

## Evidence that the problem is real

`19.99 * 100` is `1998.9999999999998` in JavaScript. Rounding hides this for ordinary prices, but not for all valid ones:
`Math.round(parseFloat("39013103017373.13") * 100)` is off by one minor unit while still inside the safe-integer range.
Both are pinned as tests, and the second was found by brute-force search after a mutation test showed a gap.

## Consequences

- Conversions between decimal text and minor units exist in exactly one place.
- No arithmetic (add, multiply) is provided yet because nothing needs it; it would be added here, in one place, when needed.
- Adding a currency means adding one line to the table, after checking the provider's rules for it.

## Alternatives considered

- **A decimal library** (decimal.js, big.js): general, but more power than needed and still leaves "which currency has how many
  decimals" to the caller. Integers plus an exponent table is smaller and matches the provider's own model.
- **Storing `numeric(12,2)` in the database:** couples storage to two decimals, which is wrong for JPY. Minor units in an integer column work for all.
