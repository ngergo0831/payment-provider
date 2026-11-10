import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { OutboxRepository, QueuedMessage } from '../../application/ports/repositories';
import { OutboxRecord } from './outbox.record';

@Injectable()
export class TypeOrmOutboxRepository extends OutboxRepository {
  constructor(@InjectRepository(OutboxRecord) private readonly records: Repository<OutboxRecord>) {
    super();
  }

  async findDue(now: Date, limit: number): Promise<QueuedMessage[]> {
    const rows = await this.records.find({
      where: { processedAt: IsNull(), availableAt: LessThanOrEqual(now) },
      order: { availableAt: 'ASC' },
      take: limit,
    });
    return rows.map((row) => ({ id: row.id, type: row.type, payload: row.payload, attempts: row.attempts }));
  }

  async markDelivered(messageId: string, now: Date): Promise<void> {
    await this.records.update({ id: messageId }, { processedAt: now });
  }

  async markFailed(messageId: string, reason: string, retryAt: Date): Promise<void> {
    await this.records
      .createQueryBuilder()
      .update(OutboxRecord)
      .set({ attempts: () => 'attempts + 1', lastError: reason, availableAt: retryAt })
      .where('id = :id', { id: messageId })
      .execute();
  }
}
