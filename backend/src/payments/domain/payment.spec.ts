import { Money } from './money';
import { Payment, PaymentInvariantError, TransitionOutcome } from './payment';
import { canTransition, isFinal, PaymentStatus } from './payment-status';

const { CREATED, REQUIRES_ACTION, PROCESSING, SUCCEEDED, FAILED, CANCELED } = PaymentStatus;
const ALL = Object.values(PaymentStatus);

const T0 = new Date('2026-11-09T10:00:00Z');
const T1 = new Date('2026-11-09T10:05:00Z');
const newPayment = () => Payment.start({ companyId: 'company-1', provider: 'mock', amount: Money.of(4900, 'USD') }, T0);

describe('Payment.start', () => {
  it('begins CREATED, unknown to the provider, at revision 0', () => {
    const payment = newPayment();
    expect(payment).toMatchObject({
      companyId: 'company-1',
      provider: 'mock',
      status: CREATED,
      providerRef: null,
      failureCode: null,
      version: 0,
      lastSyncedAt: null,
      createdAt: T0,
      updatedAt: T0,
    });
    expect(payment.amount.equals(Money.of(4900, 'USD'))).toBe(true);
    expect(payment.isFinal()).toBe(false);
  });

  it('gets a unique id', () => {
    expect(newPayment().id).toMatch(/^[0-9a-f-]{36}$/);
    expect(newPayment().id).not.toBe(newPayment().id);
  });

  it('refuses a zero amount: there is nothing to collect', () => {
    expect(() => Payment.start({ companyId: 'c', provider: 'mock', amount: Money.of(0, 'USD') })).toThrow(PaymentInvariantError);
  });
});

describe('Payment.applyStatus', () => {
  it('walks the happy path CREATED -> REQUIRES_ACTION -> PROCESSING -> SUCCEEDED', () => {
    const payment = newPayment();
    expect(payment.applyStatus(REQUIRES_ACTION)).toBe(TransitionOutcome.APPLIED);
    expect(payment.applyStatus(PROCESSING)).toBe(TransitionOutcome.APPLIED);
    expect(payment.applyStatus(SUCCEEDED)).toBe(TransitionOutcome.APPLIED);
    expect(payment.isSucceeded()).toBe(true);
    expect(payment.isFinal()).toBe(true);
  });

  it('treats a repeat of the same status as UNCHANGED, so a duplicated message is harmless', () => {
    const payment = newPayment();
    payment.applyStatus(SUCCEEDED, null, T0);
    expect(payment.applyStatus(SUCCEEDED, null, T1)).toBe(TransitionOutcome.UNCHANGED);
    expect(payment.updatedAt).toEqual(T0);
  });

  describe('a late or out-of-order report can never corrupt a final payment', () => {
    it('SUCCEEDED stays SUCCEEDED when a stale "failed" arrives afterwards', () => {
      const payment = newPayment();
      payment.applyStatus(SUCCEEDED);

      expect(payment.applyStatus(FAILED, 'card_declined')).toBe(TransitionOutcome.REJECTED);
      expect(payment.applyStatus(PROCESSING)).toBe(TransitionOutcome.REJECTED);
      expect(payment.applyStatus(CANCELED)).toBe(TransitionOutcome.REJECTED);

      expect(payment.status).toBe(SUCCEEDED);
      expect(payment.failureCode).toBeNull();
    });

    it('CANCELED stays CANCELED', () => {
      const payment = newPayment();
      payment.applyStatus(CANCELED);
      expect(payment.applyStatus(SUCCEEDED)).toBe(TransitionOutcome.REJECTED);
      expect(payment.status).toBe(CANCELED);
    });

    it('does not move backwards: PROCESSING never returns to REQUIRES_ACTION', () => {
      const payment = newPayment();
      payment.applyStatus(PROCESSING);
      expect(payment.applyStatus(REQUIRES_ACTION)).toBe(TransitionOutcome.REJECTED);
      expect(payment.status).toBe(PROCESSING);
    });

    it('a rejected move changes nothing at all, not even the timestamp', () => {
      const payment = newPayment();
      payment.applyStatus(SUCCEEDED, null, T0);
      const before = payment.toSnapshot();

      payment.applyStatus(FAILED, 'x', T1);

      expect(payment.toSnapshot()).toEqual(before);
    });
  });

  describe('failure and retry', () => {
    it('records why a payment failed', () => {
      const payment = newPayment();
      payment.applyStatus(FAILED, 'insufficient_funds');
      expect(payment).toMatchObject({ status: FAILED, failureCode: 'insufficient_funds' });
      expect(payment.isFinal()).toBe(false);
    });

    it('lets the customer retry on the same payment, and clears the old failure reason', () => {
      const payment = newPayment();
      payment.applyStatus(FAILED, 'card_declined');

      expect(payment.applyStatus(PROCESSING)).toBe(TransitionOutcome.APPLIED);
      expect(payment.failureCode).toBeNull();

      expect(payment.applyStatus(SUCCEEDED)).toBe(TransitionOutcome.APPLIED);
      expect(payment.failureCode).toBeNull();
    });

    it('can fail again with a different reason, and keeps the newest', () => {
      const payment = newPayment();
      payment.applyStatus(FAILED, 'card_declined', T0);

      expect(payment.applyStatus(FAILED, 'expired_card', T1)).toBe(TransitionOutcome.APPLIED);

      expect(payment.failureCode).toBe('expired_card');
      expect(payment.updatedAt).toEqual(T1);
    });

    it('repeating the same failure reason is UNCHANGED', () => {
      const payment = newPayment();
      payment.applyStatus(FAILED, 'card_declined');
      expect(payment.applyStatus(FAILED, 'card_declined')).toBe(TransitionOutcome.UNCHANGED);
    });

    it('keeps a known reason when the repeat carries none', () => {
      const payment = newPayment();
      payment.applyStatus(FAILED, 'card_declined');
      expect(payment.applyStatus(FAILED, null)).toBe(TransitionOutcome.UNCHANGED);
      expect(payment.failureCode).toBe('card_declined');
    });

    it('ignores a failure code on a status that is not FAILED', () => {
      const payment = newPayment();
      payment.applyStatus(PROCESSING, 'should_be_ignored');
      expect(payment.failureCode).toBeNull();
    });
  });

  it('updates the timestamp only when something actually changed', () => {
    const payment = newPayment();
    payment.applyStatus(PROCESSING, null, T1);
    expect(payment.updatedAt).toEqual(T1);
  });

  it('never touches `version`: that is persistence\'s revision counter (optimistic locking), not ours', () => {
    const payment = newPayment();
    payment.applyStatus(PROCESSING);
    payment.applyStatus(SUCCEEDED);
    expect(payment.version).toBe(0);
  });
});

describe('Payment.attachProviderRef', () => {
  it('links the payment to the provider\'s record', () => {
    const payment = newPayment();
    payment.attachProviderRef('pi_123', T1);
    expect(payment).toMatchObject({ providerRef: 'pi_123', updatedAt: T1 });
  });

  it('is idempotent for the same reference', () => {
    const payment = newPayment();
    payment.attachProviderRef('pi_123');
    expect(() => payment.attachProviderRef('pi_123')).not.toThrow();
  });

  it('refuses a DIFFERENT reference: a payment belongs to exactly one provider payment (mixing two charges)', () => {
    const payment = newPayment();
    payment.attachProviderRef('pi_123');
    expect(() => payment.attachProviderRef('pi_999')).toThrow(PaymentInvariantError);
    expect(payment.providerRef).toBe('pi_123');
  });
});

describe('snapshots (what the persistence mapper uses)', () => {
  it('round-trips without losing anything', () => {
    const payment = newPayment();
    payment.attachProviderRef('pi_123', T1);
    payment.applyStatus(FAILED, 'card_declined', T1);
    payment.markSynced(T1);

    const restored = Payment.restore(payment.toSnapshot());

    expect(restored.toSnapshot()).toEqual(payment.toSnapshot());
    expect(restored.applyStatus(SUCCEEDED)).toBe(TransitionOutcome.APPLIED);
  });

  it('a snapshot is a copy: changing it cannot change the payment', () => {
    const payment = newPayment();
    const snapshot = payment.toSnapshot();
    snapshot.status = SUCCEEDED;
    expect(payment.status).toBe(CREATED);
  });

  it('records when it was last compared with the provider', () => {
    const payment = newPayment();
    payment.markSynced(T1);
    expect(payment.lastSyncedAt).toEqual(T1);
  });
});

/**
 * RANDOMIZED TEST. Instead of picking a few event orders by hand, throw thousands of random ones at the machine
 * and check that its guarantees hold for ALL of them. A small seeded generator keeps failures reproducible.
 */
describe('invariants hold for any order of provider reports', () => {
  const mulberry32 = (seed: number) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const CODES = [null, 'card_declined', 'expired_card'];

  it('over 5000 random sequences of up to 15 reports each', () => {
    const random = mulberry32(20261109);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];

    for (let run = 0; run < 5000; run++) {
      const payment = newPayment();
      let firstFinal: PaymentStatus | null = null;
      const length = 1 + Math.floor(random() * 15);

      for (let step = 0; step < length; step++) {
        const before = payment.toSnapshot();
        const next = pick(ALL);
        const code = pick(CODES);

        const outcome = payment.applyStatus(next, code, new Date(T0.getTime() + step + 1));

        // 1. The outcome is exactly what the specification says.
        const expected =
          next === before.status
            ? (next === FAILED && code && code !== before.failureCode ? TransitionOutcome.APPLIED : TransitionOutcome.UNCHANGED)
            : canTransition(before.status, next) ? TransitionOutcome.APPLIED : TransitionOutcome.REJECTED;
        expect(outcome).toBe(expected);

        // 2. A rejected or unchanged report leaves the payment byte-for-byte untouched.
        if (outcome !== TransitionOutcome.APPLIED) expect(payment.toSnapshot()).toEqual(before);

        // 3. A failure reason exists only on a FAILED payment.
        if (payment.status !== FAILED) expect(payment.failureCode).toBeNull();

        // 4. The FIRST final status wins, forever: no later report can change it.
        if (firstFinal === null && isFinal(payment.status)) firstFinal = payment.status;
        if (firstFinal !== null) expect(payment.status).toBe(firstFinal);

        // 5. Money identity and linkage never change through status reports.
        expect(payment.amount.equals(before.amount)).toBe(true);
        expect(payment.companyId).toBe(before.companyId);
        expect(payment.id).toBe(before.id);
      }
    }
  });
});
