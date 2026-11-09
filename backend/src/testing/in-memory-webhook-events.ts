import { InboundEvent, InboxEntry, WebhookEventRepository } from '../payments/application/ports/repositories';

/** In-memory webhook inbox for unit tests. Excluded from the production build. */
export class InMemoryWebhookEvents extends WebhookEventRepository {
  /** Event id -> when it was fully processed (null = stored, not finished). Public so tests can inspect it. */
  readonly processedAt = new Map<string, Date | null>();

  async recordIfNew(event: InboundEvent): Promise<InboxEntry> {
    if (!this.processedAt.has(event.id)) this.processedAt.set(event.id, null);
    return { alreadyProcessed: this.processedAt.get(event.id) !== null };
  }

  async markProcessed(eventId: string): Promise<void> {
    if (this.processedAt.has(eventId)) this.processedAt.set(eventId, new Date());
  }
}
