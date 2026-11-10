import { canTransition, isFinal, OPEN_STATUSES, PaymentStatus } from './payment-status';

const { CREATED, REQUIRES_ACTION, PROCESSING, SUCCEEDED, FAILED, CANCELED } = PaymentStatus;
const ALL = [CREATED, REQUIRES_ACTION, PROCESSING, SUCCEEDED, FAILED, CANCELED];

const MATRIX: Record<PaymentStatus, PaymentStatus[]> = {
  //                 CREATED  REQ_ACTION  PROCESSING  SUCCEEDED  FAILED  CANCELED
  [CREATED]: [REQUIRES_ACTION, PROCESSING, SUCCEEDED, FAILED, CANCELED],
  [REQUIRES_ACTION]: [PROCESSING, SUCCEEDED, FAILED, CANCELED],
  [PROCESSING]: [SUCCEEDED, FAILED],
  [FAILED]: [REQUIRES_ACTION, PROCESSING, SUCCEEDED, CANCELED],
  [SUCCEEDED]: [],
  [CANCELED]: [],
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

describe('final and open statuses', () => {
  it('exactly SUCCEEDED and CANCELED are final; FAILED is not, so a declined card can be retried on the same payment', () => {
    expect(ALL.filter(isFinal)).toEqual([SUCCEEDED, CANCELED]);
  });

  it('the "open" statuses are exactly the non-final ones (the one-open-payment-per-company rule uses this)', () => {
    expect([...OPEN_STATUSES].sort()).toEqual([CREATED, REQUIRES_ACTION, PROCESSING, FAILED].sort());
  });
});
