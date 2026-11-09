import type { MigrationInterface } from 'typeorm';

/**
 * Every migration, in the order they were written, listed explicitly for the same reason as ENTITIES.
 * Empty for now: the first migration arrives with the first table (task 8).
 */
export const MIGRATIONS: (new () => MigrationInterface)[] = [];
