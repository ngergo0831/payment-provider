/**
 * Stable, machine-readable error codes. API clients branch on these, never on message text
 * (messages are for humans and may be reworded). Add a code when a feature introduces a new failure.
 */
export enum ErrorCode {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  EMAIL_ALREADY_REGISTERED = 'EMAIL_ALREADY_REGISTERED',
  COMPANY_NOT_FOUND = 'COMPANY_NOT_FOUND',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
