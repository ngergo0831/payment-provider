import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('webhook_events')
export class WebhookEventRecord {
  @PrimaryColumn({ name: 'provider_event_id', type: 'varchar', length: 255 })
  providerEventId: string;

  @Column({ type: 'varchar', length: 100 })
  type: string;

  @Column({ type: 'jsonb' })
  payload: object;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;
}
