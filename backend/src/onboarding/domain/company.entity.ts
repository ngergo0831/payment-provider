import { randomUUID } from 'node:crypto';
import { Check, Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum CompanyStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  ACTIVE = 'ACTIVE',
}

export interface NewCompany {
  name: string;
  country: string;
  taxId?: string | null;
  billingEmail: string;
}

@Entity('companies')
@Check('ck_companies_status', `"status" IN ('PENDING_PAYMENT', 'ACTIVE')`)
export class Company {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'char', length: 2 })
  country: string;

  @Column({ name: 'tax_id', type: 'varchar', length: 64, nullable: true })
  taxId: string | null;

  @Column({ name: 'billing_email', type: 'varchar', length: 320 })
  billingEmail: string;

  @Column({ type: 'varchar', length: 32 })
  status: CompanyStatus;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  static register(input: NewCompany): Company {
    const company = new Company();
    company.id = randomUUID();
    company.name = input.name;
    company.country = input.country;
    company.taxId = input.taxId ?? null;
    company.billingEmail = input.billingEmail;
    company.status = CompanyStatus.PENDING_PAYMENT;
    company.activatedAt = null;
    return company;
  }

  isActive(): boolean {
    return this.status === CompanyStatus.ACTIVE;
  }

  activate(now: Date = new Date()): void {
    if (this.isActive()) return;
    this.status = CompanyStatus.ACTIVE;
    this.activatedAt = now;
  }
}
