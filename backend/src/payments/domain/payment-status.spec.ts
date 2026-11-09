import { canTransition, isFinal, OPEN_STATUSES, PaymentStatus } from './payment-status';

const { CREATED, REQUIRES_ACTION, PROCESSING, SUCCEEDED, FAILED, CANCELED } = PaymentStatus;
const ALL = [CREATED, REQUIRES_ACTION, PROCESSING, SUCCEEDED, FAILED, CANCELED];

/**
 * The state machine written out as a full matrix, independently of the implementation's table.
 * Reading this is the quickest way to learn the rules. Changing a rule means changing a line here, on purpose.
 *
 *   rows = from, columns = to, X = allowed
 */
const MATRIX: Record<PaymentStatus, PaymentStatus[]> = {
  //                 CREATED  REQ_ACTION  PROCESSING  SUCCEEDED  FAILED  CANCELED
  [CREATED]:         [        REQUIRES_ACTION, PROCESSING, SUCCEEDED, FAILED, CANCELED],
  [REQUIRES_ACTION]: [                         PROCESSING, SUCCEEDED, FAILED, CANCELED],
  [PROCESSING]:      [                                     SUCCEEDED, FAILED          ],
  [FAILED]:          [        REQUIRES_ACTION, PROCESSING, SUCCEEDED,         CANCELED],
  [SUCCEEDED]:       [],
  [CANCELED]:        [],
};

describe('payment status transitions', () => {
  const pairs = ALL.flatMap((from) => ALL.filter((to) => to !== from).map((to) => [from, to] as const));

  it.each(pairs)('%s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(MATRIX[from].includes(to));
  });

  it('covers every pair of different statuses (30 of them), so a new status cannot slip through unchecked', () => {
    expect(pairs).toHaveLength(ALL.length * (ALL.length - 1));
    expect(Object.keys(MATRIX).sort()).toEqual([...ALL].sort());
  });

  it('never treats "same status" as a move (that is handled separately as "unchanged")', () => {
    for (const status of ALL) expect(canTransition(status, status)).toBe(false);
  });
});

describe('the rules that matter most', () => {
  it('SUCCEEDED and CANCELED are final: nothing leaves them', () => {
    for (const final of [SUCCEEDED, CANCELED]) {
      expect(isFinal(final)).toBe(true);
      for (const to of ALL) expect(canTransition(final, to)).toBe(false);
    }
  });

  it('FAILED is NOT final: a declined card can be retried on the same payment (ADR 0003)', () => {
    expect(isFinal(FAILED)).toBe(false);
    expect(canTransition(FAILED, PROCESSING)).toBe(true);
    expect(canTransition(FAILED, SUCCEEDED)).toBe(true); // retry succeeded, or a late success report
  });

  it('a success can never be undone by a late failure report', () => {
    expect(canTransition(SUCCEEDED, FAILED)).toBe(false);
    expect(canTransition(SUCCEEDED, CANCELED)).toBe(false);
  });

  it('a payment in flight cannot be canceled: the money may already be moving', () => {
    expect(canTransition(PROCESSING, CANCELED)).toBe(false);
  });

  it('nothing goes back to CREATED: it is only the starting state', () => {
    for (const from of ALL) expect(canTransition(from, CREATED)).toBe(false);
  });

  it('the "open" statuses are exactly the non-final ones (the one-open-payment-per-company rule uses this)', () => {
    expect([...OPEN_STATUSES].sort()).toEqual([CREATED, REQUIRES_ACTION, PROCESSING, FAILED].sort());
  });
});
