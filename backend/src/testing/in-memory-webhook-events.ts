import { InboundEvent, StoredInboundEvent, WebhookEventRepository } from '../payments/application/ports/repositories';

/** In-memory webhook inbox for unit tests. Excluded from the production build. */
export class InMemoryWebhookEvents extends WebhookEventRepository {
  readonly rows = new Map<string, StoredInboundEvent>();

  async recordIfNew(event: InboundEvent): Promise<StoredInboundEvent> {
    if (!this.rows.has(event.id)) {
      this.rows.set(event.id, { id: event.id, type: event.type, receivedAt: new Date(), processedAt: null });
    }
    return { ...(this.rows.get(event.id) as StoredInboundEvent) };
  }

  async markProcessed(eventId: string): Promise<void> {
    const row = this.rows.get(eventId);
    if (row) row.processedAt = new Date();
  }
}
