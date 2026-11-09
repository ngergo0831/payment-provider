import { QueryFailedError } from 'typeorm';

/** PostgreSQL error code for "unique constraint violated". */
const UNIQUE_VIOLATION = '23505';

interface PgDriverError {
  code?: string;
  constraint?: string;
}

/**
 * True when `error` is a unique-constraint violation, optionally for one NAMED constraint.
 * Infrastructure-only: adapters use it to translate database failures into domain exceptions,
 * so the application layer never sees driver error codes.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as PgDriverError;
  return driverError?.code === UNIQUE_VIOLATION && (constraint === undefined || driverError.constraint === constraint);
}
