import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { isUniqueViolation } from '../../../common/database/pg-errors';
import {
  OpenPaymentAlreadyExistsError,
  PaymentConcurrentModificationError,
  PaymentRepository,
} from '../../application/ports/repositories';
import { Payment } from '../../domain/payment';
import { OPEN_STATUSES } from '../../domain/payment-status';
import { toDomain, toRecord } from './payment.mapper';
import { PaymentRecord } from './payment.record';

/** Must match the index name in the migration and on PaymentRecord. */
const UNIQUE_ONE_OPEN_PER_COMPANY = 'uq_payments_one_open_per_company';

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

  async findOpenByCompany(companyId: string): Promise<Payment | null> {
    return this.toDomainOrNull(await this.records.findOneBy({ companyId, status: In([...OPEN_STATUSES]) }));
  }

  async insert(payment: Payment): Promise<void> {
    try {
      await this.records.insert(toRecord(payment));
    } catch (error) {
      // The partial unique index is the real guard against two simultaneous "start payment" requests.
      if (isUniqueViolation(error, UNIQUE_ONE_OPEN_PER_COMPANY)) throw new OpenPaymentAlreadyExistsError();
      throw error;
    }
  }

  async save(payment: Payment): Promise<Payment> {
    const record = toRecord(payment);

    // Optimistic locking: the WHERE clause only matches while the stored version is still the one we loaded.
    // If someone else saved in between, zero rows match and nothing is overwritten.
    const result = await this.records
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

    return Payment.restore({ ...payment.toSnapshot(), version: payment.version + 1 });
  }

  private toDomainOrNull(record: PaymentRecord | null): Payment | null {
    return record ? toDomain(record) : null;
  }
}
