import { MigrationInterface, QueryRunner } from 'typeorm';

/** Webhook events are only triggers and handling them is idempotent, so the inbox table is not needed. */
export class DropWebhookEvents1794320000000 implements MigrationInterface {
  name = 'DropWebhookEvents1794320000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "webhook_events"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "webhook_events" (
        "provider_event_id" character varying(255)   NOT NULL,
        "type"              character varying(100)   NOT NULL,
        "payload"           jsonb                    NOT NULL,
        "received_at"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "processed_at"      TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "pk_webhook_events" PRIMARY KEY ("provider_event_id")
      )`);
  }
}
