import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widens the double-charge guard from "one open payment per company" to "one open or succeeded payment per company".
 * The status list must equal LIVE_STATUSES in the domain; an e2e test checks that they agree.
 */
export class OneLivePaymentPerCompany1794300000000 implements MigrationInterface {
  name = 'OneLivePaymentPerCompany1794300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_payments_one_open_per_company"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_payments_one_live_per_company" ON "payments" ("company_id")
      WHERE "status" IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED')`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_payments_one_live_per_company"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_payments_one_open_per_company" ON "payments" ("company_id")
      WHERE "status" IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'FAILED')`);
  }
}
