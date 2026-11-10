import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { isUniqueViolation } from '../../../common/database/pg-errors';
import {
  LivePaymentAlreadyExistsError,
  PaymentConcurrentModificationError,
  PaymentRepository,
  ReconciliationQuery,
} from '../../application/ports/repositories';
import { OutboxMessage } from '../../application/outbox';
import { Payment } from '../../domain/payment';
import { LIVE_STATUSES, OPEN_STATUSES } from '../../domain/payment-status';
import { OutboxRecord } from './outbox.record';
import { toDomain, toRecord } from './payment.mapper';
import { PaymentRecord, UNIQUE_ONE_LIVE_PER_COMPANY } from './payment.record';

@Injectable()
export class TypeOrmPaymentRepository extends PaymentRepository {
  constructor(@InjectRepository(PaymentRecord) private readonly records: Repository<PaymentRecord>) {
    super();
  }

  async findById(id: string): Promise<Payment | null> {
    return this.toDomainOrNull(await this.records.findOneBy({ id }));
  }

  async findByProviderRef(providerRef: string): Promise<Payment | null> {
    return this.toDomainOrNull(await this.records.findOneBy({ providerRef }));
  }

  async findLiveByCompany(companyId: string): Promise<Payment | null> {
    return this.toDomainOrNull(await this.records.findOneBy({ companyId, status: In([...LIVE_STATUSES]) }));
  }

  async findDueForReconciliation(query: ReconciliationQuery): Promise<Payment[]> {
    const rows = await this.records
      .createQueryBuilder('payment')
      .where('payment.status IN (:...open)', { open: [...OPEN_STATUSES] })
      .andWhere('payment.provider = :provider', { provider: query.provider })
      .andWhere('payment.provider_ref IS NOT NULL')
      .andWhere('payment.created_at > :createdAfter', { createdAfter: query.createdAfter })
      .andWhere(
        `COALESCE(payment.last_synced_at, payment.created_at) < CAST(:now AS timestamptz) - GREATEST(
           :minQuietMs * INTERVAL '1 millisecond', (CAST(:now AS timestamptz) - payment.created_at) * :quietFractionOfAge)`,
        { now: query.now, minQuietMs: query.minQuietMs, quietFractionOfAge: query.quietFractionOfAge },
      )
      .orderBy('COALESCE(payment.last_synced_at, payment.created_at)', 'ASC')
      .limit(query.limit)
      .getMany();
    return rows.map(toDomain);
  }

  async insert(payment: Payment): Promise<void> {
    try {
      await this.records.insert(toRecord(payment));
    } catch (error) {
      if (isUniqueViolation(error, UNIQUE_ONE_LIVE_PER_COMPANY)) throw new LivePaymentAlreadyExistsError();
      throw error;
    }
  }

  async save(payment: Payment, messages: OutboxMessage[] = []): Promise<Payment> {
    const record = toRecord(payment);

    await this.records.manager.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(PaymentRecord)
        .set({
          providerRef: record.providerRef,
          status: record.status,
          failureCode: record.failureCode,
          lastSyncedAt: record.lastSyncedAt,
          updatedAt: record.updatedAt,
          version: () => 'version + 1',
        })
        .where('id = :id AND version = :version', { id: record.id, version: record.version })
        .execute();

      if (result.affected !== 1) throw new PaymentConcurrentModificationError(payment.id);

      if (messages.length > 0) {
        const now = new Date();
        await manager.insert(
          OutboxRecord,
          messages.map((message) => ({
            id: message.id,
            type: message.type,
            payload: message.payload as object,
            createdAt: now,
            availableAt: now,
          })),
        );
      }
    });

    return Payment.restore({ ...payment.toSnapshot(), version: payment.version + 1 });
  }

  async recordSynced(paymentId: string, at: Date): Promise<void> {
    await this.records.update({ id: paymentId }, { lastSyncedAt: at });
  }

  private toDomainOrNull(record: PaymentRecord | null): Payment | null {
    return record ? toDomain(record) : null;
  }
}
