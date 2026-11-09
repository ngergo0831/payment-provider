import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { OPEN_STATUSES, PaymentStatus } from '../../domain/payment-status';

const quoted = (statuses: readonly PaymentStatus[]) => statuses.map((status) => `'${status}'`).join(', ');

/**
 * Persistence-only shape of a payment: a table row, with ORM decorators.
 * The domain `Payment` knows nothing about this class (ADR 0001, option B); the mapper converts between them.
 */
@Entity('payments')
@Index('uq_payments_provider_ref', ['providerRef'], { unique: true })
// The double-charge guard. Built from the domain's own OPEN_STATUSES so "open" is defined in ONE place.
@Index('uq_payments_one_open_per_company', ['companyId'], {
  unique: true,
  where: `"status" IN (${quoted(OPEN_STATUSES)})`,
})
@Check('ck_payments_status', `"status" IN (${quoted(Object.values(PaymentStatus))})`)
@Check('ck_payments_amount_positive', `"amount_minor" > 0`)
@Check('ck_payments_currency_upper', `"currency" = upper("currency")`)
@Check('ck_payments_version_nonnegative', `"version" >= 0`)
export class PaymentRecord {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ type: 'varchar', length: 32 })
  provider: string;

  @Column({ name: 'provider_ref', type: 'varchar', length: 255, nullable: true })
  providerRef: string | null;

  // bigint: minor units can exceed 32 bits (Money allows up to 2^53-1). The driver returns bigint as a STRING,
  // so it is converted back to a number; that is safe because Money guarantees a safe integer.
  @Column({
    name: 'amount_minor',
    type: 'bigint',
    transformer: { to: (value: number) => value, from: (value: string | null) => (value === null ? value : Number(value)) },
  })
  amountMinor: number;

  @Column({ type: 'char', length: 3 })
  currency: string;

  @Column({ type: 'varchar', length: 32 })
  status: string;

  @Column({ name: 'failure_code', type: 'varchar', length: 100, nullable: true })
  failureCode: string | null;

  /** Revision counter for optimistic locking: every successful update adds 1. */
  @Column({ type: 'integer', default: 0 })
  version: number;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  // Set by the domain (not by the database), so the domain object and the row always agree.
  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Foreign key to companies. Referenced BY NAME so payments' persistence code does not import onboarding's entity.
  @ManyToOne('Company', { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'company_id', foreignKeyConstraintName: 'fk_payments_company' })
  company?: object;
}
