import { OutboxMessage } from '../payments/application/outbox';
import { BillingProfile, CompanyGateway, PlanPricing } from '../payments/application/ports/collaborators';
import {
  OpenPaymentAlreadyExistsError,
  PaymentConcurrentModificationError,
  PaymentRepository,
} from '../payments/application/ports/repositories';
import { Money } from '../payments/domain/money';
import { Payment, PaymentSnapshot } from '../payments/domain/payment';

/**
 * In-memory implementations of the payment ports for unit tests: fast, deterministic, no database.
 * They honour the same contract as the real adapters (one open payment per company, optimistic locking, save returns
 * the new version). Excluded from the production build (tsconfig.build.json).
 */
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

  async findOpenByCompany(companyId: string): Promise<Payment | null> {
    return this.all().find((payment) => payment.companyId === companyId && !payment.isFinal()) ?? null;
  }

  async findDueForReconciliation(query: { notSyncedSince: Date; createdAfter: Date; limit: number }): Promise<Payment[]> {
    return this.all()
      .filter((payment) => !payment.isFinal() && payment.providerRef !== null)
      .filter((payment) => payment.createdAt > query.createdAfter)
      .filter((payment) => (payment.lastSyncedAt ?? payment.createdAt) < query.notSyncedSince)
      .sort((a, b) => (a.lastSyncedAt ?? a.createdAt).getTime() - (b.lastSyncedAt ?? b.createdAt).getTime())
      .slice(0, query.limit);
  }

  async insert(payment: Payment): Promise<void> {
    if (this.all().some((existing) => existing.companyId === payment.companyId && !existing.isFinal())) {
      throw new OpenPaymentAlreadyExistsError();
    }
    this.rows.set(payment.id, payment.toSnapshot());
  }

  /** Messages queued together with saves (the outbox), in order. */
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
}

export class FakeCompanyGateway extends CompanyGateway {
  readonly profiles = new Map<string, BillingProfile>();

  add(companyId: string, isActive = false): void {
    this.profiles.set(companyId, { companyId, isActive });
  }

  async findBillingProfile(companyId: string): Promise<BillingProfile | null> {
    return this.profiles.get(companyId) ?? null;
  }
}

export class FixedPricing extends PlanPricing {
  constructor(readonly price: Money = Money.of(4900, 'USD')) {
    super();
  }
}
