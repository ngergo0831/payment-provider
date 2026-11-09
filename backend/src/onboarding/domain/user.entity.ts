import { randomUUID } from 'node:crypto';
import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { Company } from './company.entity';

export enum UserRole {
  ADMIN = 'ADMIN',
}

export interface NewAdminUser {
  /** Must already be normalised to lower case (the database rejects anything else). */
  email: string;
  fullName: string;
  companyId: string;
}

/**
 * A person who belongs to exactly one company. There is no password: sign-in is deliberately out of scope
 * for this slice (registration hands back a token directly).
 */
@Entity('users')
@Unique('uq_users_email', ['email'])
@Index('ix_users_company_id', ['companyId'])
// With lower-case enforced here, a plain UNIQUE on email is already case-insensitive:
// "Ada@x.com" and "ada@x.com" cannot both exist, even under a race between two registrations.
@Check('ck_users_email_lowercase', `"email" = lower("email")`)
@Check('ck_users_role', `"role" IN ('ADMIN')`)
export class User {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 320 })
  email: string;

  @Column({ name: 'full_name', type: 'varchar', length: 120 })
  fullName: string;

  @Column({ type: 'varchar', length: 32 })
  role: UserRole;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  // The foreign key: a user cannot reference a company that does not exist, and a company that still has
  // users cannot be deleted. Loaded only on request; we normally work with `companyId`.
  @ManyToOne(() => Company, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'company_id', foreignKeyConstraintName: 'fk_users_company' })
  company?: Company;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  static createAdmin(input: NewAdminUser): User {
    const user = new User();
    user.id = randomUUID();
    user.email = input.email;
    user.fullName = input.fullName;
    user.role = UserRole.ADMIN;
    user.companyId = input.companyId;
    return user;
  }
}
