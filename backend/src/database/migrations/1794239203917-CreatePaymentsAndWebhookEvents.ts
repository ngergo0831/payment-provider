import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentsAndWebhookEvents1794239203917 implements MigrationInterface {
  name = 'CreatePaymentsAndWebhookEvents1794239203917';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id"             uuid                     NOT NULL,
        "company_id"     uuid                     NOT NULL,
        "provider"       character varying(32)    NOT NULL,
        "provider_ref"   character varying(255),
        "amount_minor"   bigint                   NOT NULL,
        "currency"       character(3)             NOT NULL,
        "status"         character varying(32)    NOT NULL,
        "failure_code"   character varying(100),
        "version"        integer                  NOT NULL DEFAULT 0,
        "last_synced_at" TIMESTAMP WITH TIME ZONE,
        "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL,
        "updated_at"     TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "pk_payments" PRIMARY KEY ("id"),
        CONSTRAINT "ck_payments_status" CHECK ("status" IN
          ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED')),
        CONSTRAINT "ck_payments_amount_positive" CHECK ("amount_minor" > 0),
        CONSTRAINT "ck_payments_currency_upper" CHECK ("currency" = upper("currency")),
        CONSTRAINT "ck_payments_version_nonnegative" CHECK ("version" >= 0),
        CONSTRAINT "fk_payments_company" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT
      )`);

    await queryRunner.query(`CREATE UNIQUE INDEX "uq_payments_provider_ref" ON "payments" ("provider_ref")`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_payments_one_open_per_company" ON "payments" ("company_id")
      WHERE "status" IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'FAILED')`);

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

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "webhook_events"`);
    await queryRunner.query(`DROP TABLE "payments"`);
  }
}
