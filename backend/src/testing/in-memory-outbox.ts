import { OutboxRepository, QueuedMessage } from '../payments/application/ports/repositories';

interface Row {
  message: QueuedMessage;
  availableAt: Date;
  deliveredAt: Date | null;
  lastError: string | null;
}

export class InMemoryOutbox extends OutboxRepository {
  private readonly rows = new Map<string, Row>();

  /** Simulate a crash after the message was acted on but before it could be marked delivered. */
  failNextMarkDelivered = false;

  add(type: string, payload: unknown = {}, availableAt = new Date(0)): string {
    const id = `msg-${this.rows.size + 1}`;
    this.rows.set(id, { message: { id, type, payload, attempts: 0 }, availableAt, deliveredAt: null, lastError: null });
    return id;
  }

  row(id: string): Row {
    return this.rows.get(id) as Row;
  }

  async findDue(now: Date, limit: number): Promise<QueuedMessage[]> {
    return [...this.rows.values()]
      .filter((row) => !row.deliveredAt && row.availableAt <= now)
      .sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime())
      .slice(0, limit)
      .map((row) => ({ ...row.message }));
  }

  async markDelivered(messageId: string, now: Date): Promise<void> {
    if (this.failNextMarkDelivered) {
      this.failNextMarkDelivered = false;
      throw new Error('crashed before the message could be marked delivered');
    }
    this.row(messageId).deliveredAt = now;
  }

  async markFailed(messageId: string, reason: string, retryAt: Date): Promise<void> {
    const row = this.row(messageId);
    row.message.attempts++;
    row.lastError = reason;
    row.availableAt = retryAt;
  }
}
