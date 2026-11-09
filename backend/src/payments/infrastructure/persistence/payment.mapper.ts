import { Money } from '../../domain/money';
import { Payment } from '../../domain/payment';
import { PaymentStatus } from '../../domain/payment-status';
import { PaymentRecord } from './payment.record';

export function toRecord(payment: Payment): PaymentRecord {
  const snapshot = payment.toSnapshot();
  const record = new PaymentRecord();
  record.id = snapshot.id;
  record.companyId = snapshot.companyId;
  record.provider = snapshot.provider;
  record.providerRef = snapshot.providerRef;
  record.amountMinor = snapshot.amount.amountMinor;
  record.currency = snapshot.amount.currency;
  record.status = snapshot.status;
  record.failureCode = snapshot.failureCode;
  record.version = snapshot.version;
  record.lastSyncedAt = snapshot.lastSyncedAt;
  record.createdAt = snapshot.createdAt;
  record.updatedAt = snapshot.updatedAt;
  return record;
}

export function toDomain(record: PaymentRecord): Payment {
  return Payment.restore({
    id: record.id,
    companyId: record.companyId,
    provider: record.provider,
    providerRef: record.providerRef,
    amount: Money.of(record.amountMinor, record.currency),
    status: record.status as PaymentStatus,
    failureCode: record.failureCode,
    version: record.version,
    lastSyncedAt: record.lastSyncedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}
