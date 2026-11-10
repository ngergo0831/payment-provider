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

  attachProviderRef(providerRef: string, now: Date = new Date()): void {
    if (this.state.providerRef === providerRef) return;
    if (this.state.providerRef !== null) {
      throw new PaymentInvariantError(`Payment ${this.id} is already linked to ${this.state.providerRef}, not ${providerRef}`);
    }
    this.state = { ...this.state, providerRef, updatedAt: now };
  }

  applyStatus(next: PaymentStatus, failureCode: string | null = null, now: Date = new Date()): TransitionOutcome {
    if (next === this.state.status) {
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
