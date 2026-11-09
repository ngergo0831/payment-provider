import { InboundEvent, InboxEntry, WebhookEventRepository } from '../payments/application/ports/repositories';

export class InMemoryWebhookEvents extends WebhookEventRepository {
  readonly processedAt = new Map<string, Date | null>();

  async recordIfNew(event: InboundEvent): Promise<InboxEntry> {
    if (!this.processedAt.has(event.id)) this.processedAt.set(event.id, null);
    return { alreadyProcessed: this.processedAt.get(event.id) !== null };
  }

  async markProcessed(eventId: string): Promise<void> {
    if (this.processedAt.has(eventId)) this.processedAt.set(eventId, new Date());
  }
}
