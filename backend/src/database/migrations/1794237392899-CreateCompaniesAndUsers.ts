import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 1: companies and users.
 * Written by hand and checked against the entities by the "no schema drift" e2e test.
 * Constraints are named explicitly so errors and code can refer to them (e.g. uq_users_email).
 */
export class CreateCompaniesAndUsers1794237392899 implements MigrationInterface {
  name = 'CreateCompaniesAndUsers1794237392899';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "companies" (
        "id"            uuid                     NOT NULL,
        "name"          character varying(200)   NOT NULL,
        "country"       character(2)             NOT NULL,
        "tax_id"        character varying(64),
        "billing_email" character varying(320)   NOT NULL,
        "status"        character varying(32)    NOT NULL,
        "activated_at"  TIMESTAMP WITH TIME ZONE,
        "created_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_companies" PRIMARY KEY ("id"),
        CONSTRAINT "ck_companies_status" CHECK ("status" IN ('PENDING_PAYMENT', 'ACTIVE'))
      )`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"         uuid                     NOT NULL,
        "email"      character varying(320)   NOT NULL,
        "full_name"  character varying(120)   NOT NULL,
        "role"       character varying(32)    NOT NULL,
        "company_id" uuid                     NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_users" PRIMARY KEY ("id"),
        CONSTRAINT "uq_users_email" UNIQUE ("email"),
        CONSTRAINT "ck_users_email_lowercase" CHECK ("email" = lower("email")),
        CONSTRAINT "ck_users_role" CHECK ("role" IN ('ADMIN')),
        CONSTRAINT "fk_users_company" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT
      )`);
    await queryRunner.query(`CREATE INDEX "ix_users_company_id" ON "users" ("company_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "companies"`);
  }
}
