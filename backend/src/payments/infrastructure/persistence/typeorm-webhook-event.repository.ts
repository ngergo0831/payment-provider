import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InboundEvent, InboxEntry, WebhookEventRepository } from '../../application/ports/repositories';
import { WebhookEventRecord } from './webhook-event.record';

@Injectable()
export class TypeOrmWebhookEventRepository extends WebhookEventRepository {
  constructor(@InjectRepository(WebhookEventRecord) private readonly records: Repository<WebhookEventRecord>) {
    super();
  }

  async recordIfNew(event: InboundEvent): Promise<InboxEntry> {
    // INSERT ... ON CONFLICT DO NOTHING: when the same event arrives twice at the same moment, one insert wins and
    // the other quietly does nothing. Neither errors, and both then read the same stored row.
    await this.records
      .createQueryBuilder()
      .insert()
      // The port says "any payload"; the column is JSON, so it must be an object (providers always send one).
      .values({ providerEventId: event.id, type: event.type, payload: event.payload as object, processedAt: null })
      .orIgnore()
      .execute();

    const stored = await this.records.findOneByOrFail({ providerEventId: event.id });
    return { alreadyProcessed: stored.processedAt !== null };
  }

  async markProcessed(eventId: string): Promise<void> {
    await this.records.update({ providerEventId: eventId }, { processedAt: new Date() });
  }
}
