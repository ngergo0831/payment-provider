import type { MigrationInterface } from 'typeorm';
import { CreateCompaniesAndUsers1794237392899 } from './1794237392899-CreateCompaniesAndUsers';
import { CreateOutboxMessages1794240546520 } from './1794240546520-CreateOutboxMessages';
import { CreatePaymentsAndWebhookEvents1794239203917 } from './1794239203917-CreatePaymentsAndWebhookEvents';
import { OneLivePaymentPerCompany1794300000000 } from './1794300000000-OneLivePaymentPerCompany';
import { DropUserRole1794310000000 } from './1794310000000-DropUserRole';
import { DropWebhookEvents1794320000000 } from './1794320000000-DropWebhookEvents';

/**
 * Never edit or reorder a migration that has been committed: add a new one instead!
 */
export const MIGRATIONS: (new () => MigrationInterface)[] = [
  CreateCompaniesAndUsers1794237392899,
  CreatePaymentsAndWebhookEvents1794239203917,
  CreateOutboxMessages1794240546520,
  OneLivePaymentPerCompany1794300000000,
  DropUserRole1794310000000,
  DropWebhookEvents1794320000000,
];
