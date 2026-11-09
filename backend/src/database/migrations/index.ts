import type { MigrationInterface } from 'typeorm';
import { CreateCompaniesAndUsers1794237392899 } from './1794237392899-CreateCompaniesAndUsers';
import { CreateOutboxMessages1794240546520 } from './1794240546520-CreateOutboxMessages';
import { CreatePaymentsAndWebhookEvents1794239203917 } from './1794239203917-CreatePaymentsAndWebhookEvents';

/**
 * Every migration, in the order they were written, listed explicitly for the same reason as ENTITIES.
 * Never edit or reorder a migration that has been committed: add a new one instead.
 */
export const MIGRATIONS: (new () => MigrationInterface)[] = [
  CreateCompaniesAndUsers1794237392899,
  CreatePaymentsAndWebhookEvents1794239203917,
  CreateOutboxMessages1794240546520,
];
