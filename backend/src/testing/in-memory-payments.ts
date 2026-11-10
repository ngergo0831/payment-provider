import { OutboxMessage } from '../payments/application/outbox';
import { BillingProfile, CompanyGateway, PlanPricing } from '../payments/application/ports/collaborators';
import {
  LivePaymentAlreadyExistsError,
  PaymentConcurrentModificationError,
  PaymentRepository,
  ReconciliationQuery,
} from '../payments/application/ports/repositories';
import { Money } from '../payments/domain/money';
import { Payment, PaymentSnapshot } from '../payments/domain/payment';
import { PaymentStatus } from '../payments/domain/payment-status';

const isLive = (payment: Payment) => payment.status !== PaymentStatus.CANCELED;

export class InMemoryPaymentRepository extends PaymentRepository {
  private readonly rows = new Map<string, PaymentSnapshot>();

  /** Simulate other actors saving first: the next N calls to `save` lose the optimistic-lock race. */
  conflictsToInject = 0;
  saveCalls = 0;

  get count(): number {
    return this.rows.size;
  }

  all(): Payment[] {
    return [...this.rows.values()].map((snapshot) => Payment.restore(snapshot));
  }

  async findById(id: string): Promise<Payment | null> {
    const row = this.rows.get(id);
    return row ? Payment.restore(row) : null;
  }

  async findByProviderRef(providerRef: string): Promise<Payment | null> {
    return this.all().find((payment) => payment.providerRef === providerRef) ?? null;
  }

  async findLiveByCompany(companyId: string): Promise<Payment | null> {
    return this.all().find((payment) => payment.companyId === companyId && isLive(payment)) ?? null;
  }

  async findDueForReconciliation(query: ReconciliationQuery): Promise<Payment[]> {
    return this.all()
      .filter((payment) => !payment.isFinal() && payment.providerRef !== null && payment.provider === query.provider)
      .filter((payment) => payment.createdAt > query.createdAfter)
      .filter((payment) => {
        const age = query.now.getTime() - payment.createdAt.getTime();
        const quietFor = Math.max(query.minQuietMs, age * query.quietFractionOfAge);
        return (payment.lastSyncedAt ?? payment.createdAt).getTime() < query.now.getTime() - quietFor;
      })
      .sort((a, b) => (a.lastSyncedAt ?? a.createdAt).getTime() - (b.lastSyncedAt ?? b.createdAt).getTime())
      .slice(0, query.limit);
  }

  async insert(payment: Payment): Promise<void> {
    if (this.all().some((existing) => existing.companyId === payment.companyId && isLive(existing))) {
      throw new LivePaymentAlreadyExistsError();
    }
    this.rows.set(payment.id, payment.toSnapshot());
  }

  readonly outbox: OutboxMessage[] = [];

  async save(payment: Payment, messages: OutboxMessage[] = []): Promise<Payment> {
    this.saveCalls++;
    const stored = this.rows.get(payment.id);

    if (this.conflictsToInject > 0 && stored) {
      this.conflictsToInject--;
      // Someone else "saved first": bump the stored version so the caller's copy is stale.
      this.rows.set(payment.id, { ...stored, version: stored.version + 1 });
      throw new PaymentConcurrentModificationError(payment.id);
    }
    if (!stored || stored.version !== payment.version) throw new PaymentConcurrentModificationError(payment.id);

    const next = { ...payment.toSnapshot(), version: payment.version + 1 };
    this.rows.set(payment.id, next);
    this.outbox.push(...messages); // only reached when the save succeeded, like the real transaction
    return Payment.restore(next);
  }

  async recordSynced(paymentId: string, at: Date): Promise<void> {
    const stored = this.rows.get(paymentId);
    if (stored) this.rows.set(paymentId, { ...stored, lastSyncedAt: at });
  }
}

export class FakeCompanyGateway extends CompanyGateway {
  readonly profiles = new Map<string, BillingProfile>();
  readonly activated: string[] = [];
  /** Simulate onboarding being unable to activate: every call fails with this until it is cleared. */
  failActivationWith?: Error;

  add(companyId: string, isActive = false): void {
    this.profiles.set(companyId, { companyId, isActive });
  }

  async findBillingProfile(companyId: string): Promise<BillingProfile | null> {
    return this.profiles.get(companyId) ?? null;
  }

  async activate(companyId: string): Promise<void> {
    if (this.failActivationWith) throw this.failActivationWith;
    this.activated.push(companyId);
  }
}

export class FixedPricing extends PlanPricing {
  constructor(readonly price: Money = Money.of(4900, 'USD')) {
    super();
  }
}
