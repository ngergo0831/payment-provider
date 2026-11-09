import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutboxMessages1794240546520 implements MigrationInterface {
  name = 'CreateOutboxMessages1794240546520';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "outbox_messages" (
        "id"           uuid                     NOT NULL,
        "type"         character varying(100)   NOT NULL,
        "payload"      jsonb                    NOT NULL,
        "created_at"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "available_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "processed_at" TIMESTAMP WITH TIME ZONE,
        "attempts"     integer                  NOT NULL DEFAULT 0,
        "last_error"   text,
        CONSTRAINT "pk_outbox_messages" PRIMARY KEY ("id")
      )`);

    await queryRunner.query(`CREATE INDEX "ix_outbox_pending" ON "outbox_messages" ("available_at") WHERE "processed_at" IS NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "outbox_messages"`);
  }
}
