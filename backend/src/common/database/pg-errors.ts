import { QueryFailedError } from 'typeorm';

const UNIQUE_VIOLATION = '23505';

interface PgDriverError {
  code?: string;
  constraint?: string;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as PgDriverError;
  return driverError?.code === UNIQUE_VIOLATION && (constraint === undefined || driverError.constraint === constraint);
}
