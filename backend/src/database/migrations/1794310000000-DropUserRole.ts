import { MigrationInterface, QueryRunner } from 'typeorm';

/** `role` only ever held 'ADMIN' and nothing authorised on it. */
export class DropUserRole1794310000000 implements MigrationInterface {
  name = 'DropUserRole1794310000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "ck_users_role"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "role" character varying(32) NOT NULL DEFAULT 'ADMIN'`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "ck_users_role" CHECK ("role" IN ('ADMIN'))`);
  }
}
