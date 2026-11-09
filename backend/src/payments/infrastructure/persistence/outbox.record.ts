import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** A queued message. Written together with the change that caused it; delivered later by the dispatcher. */
@Entity('outbox_messages')
// The dispatcher only ever looks at unprocessed rows, so only those are indexed.
@Index('ix_outbox_pending', ['availableAt'], { where: '"processed_at" IS NULL' })
export class OutboxRecord {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  type: string;

  @Column({ type: 'jsonb' })
  payload: object;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  /** Not delivered before this moment: pushed into the future after a failed attempt (simple back-off). */
  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt: Date;

  /** Null until delivered. */
  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;
}
