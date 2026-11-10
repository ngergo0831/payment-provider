import { randomUUID } from 'node:crypto';
import { Money } from './money';
import { canTransition, isFinal, PaymentStatus } from './payment-status';

export class PaymentInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentInvariantError';
  }
}

export enum TransitionOutcome {
  APPLIED = 'APPLIED',
  UNCHANGED = 'UNCHANGED',
  /** An illegal move, i.e. stale or out-of-order information. The payment was left untouched. */
  REJECTED = 'REJECTED',
}

export interface PaymentSnapshot {
  id: string;
  companyId: string;
  provider: string;
  providerRef: string | null;
  amount: Money;
  status: PaymentStatus;
  failureCode: string | null;
  /** The stored revision, for optimistic locking. Owned by persistence: the domain never changes it. */
  version: number;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StartPaymentInput {
  companyId: string;
  provider: string;
  amount: Money;
}

export class Payment {
  private constructor(private state: PaymentSnapshot) {}

  static start(input: StartPaymentInput, now: Date = new Date()): Payment {
    if (!input.amount.isPositive()) {
      throw new PaymentInvariantError(`A payment must be for a positive amount, got ${input.amount.toString()}`);
    }
    return new Payment({
      id: randomUUID(),
      companyId: input.companyId,
      provider: input.provider,
      providerRef: null,
      amount: input.amount,
      status: PaymentStatus.CREATED,
      failureCode: null,
      version: 0,
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(snapshot: PaymentSnapshot): Payment {
    return new Payment({ ...snapshot });
  }

  toSnapshot(): PaymentSnapshot {
    return { ...this.state };
  }

  get id(): string {
    return this.state.id;
  }
  get companyId(): string {
    return this.state.companyId;
  }
  get provider(): string {
    return this.state.provider;
  }
  get providerRef(): string | null {
    return this.state.providerRef;
  }
  get amount(): Money {
    return this.state.amount;
  }
  get status(): PaymentStatus {
    return this.state.status;
  }
  get failureCode(): string | null {
    return this.state.failureCode;
  }
  get version(): number {
    return this.state.version;
  }
  get lastSyncedAt(): Date | null {
    return this.state.lastSyncedAt;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get updatedAt(): Date {
    return this.state.updatedAt;
  }

  isSucceeded(): boolean {
    return this.state.status === PaymentStatus.SUCCEEDED;
  }

  isFinal(): boolean {
    return isFinal(this.state.status);
  }

  /**
   * Links this payment to the provider's own record of it. Idempotent for the same reference (a replayed
   * report is harmless), but a payment can only ever belong to one provider payment: a different reference
   * would mean we are about to mix up two charges.
   */
  attachProviderRef(providerRef: string, now: Date = new Date()): void {
    if (this.state.providerRef === providerRef) return;
    if (this.state.providerRef !== null) {
      throw new PaymentInvariantError(`Payment ${this.id} is already linked to ${this.state.providerRef}, not ${providerRef}`);
    }
    this.state = { ...this.state, providerRef, updatedAt: now };
  }

  /**
   * The only way the status changes. Used for every source of truth about the payment
   * (webhook, reconciliation, "resume checkout"), so they all obey the same rules.
   *
   * `failureCode` is meaningful only for FAILED; it is cleared on any other status.
   */
  applyStatus(next: PaymentStatus, failureCode: string | null = null, now: Date = new Date()): TransitionOutcome {
    if (next === this.state.status) {
      // A repeat of the same news. The one thing that can still be new is a different decline reason.
      if (next === PaymentStatus.FAILED && failureCode && failureCode !== this.state.failureCode) {
        this.state = { ...this.state, failureCode, updatedAt: now };
        return TransitionOutcome.APPLIED;
      }
      return TransitionOutcome.UNCHANGED;
    }

    if (!canTransition(this.state.status, next)) return TransitionOutcome.REJECTED;

    this.state = {
      ...this.state,
      status: next,
      failureCode: next === PaymentStatus.FAILED ? failureCode : null,
      updatedAt: now,
    };
    return TransitionOutcome.APPLIED;
  }

  markSynced(now: Date = new Date()): void {
    this.state = { ...this.state, lastSyncedAt: now };
  }
}
