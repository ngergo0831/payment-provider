import { ErrorCode } from './error-codes';

/**
 * WHAT KIND of failure happened, independent of any transport.
 * Business code throws exceptions with a kind; only the HTTP exception filter turns a kind into a
 * status code. Business code therefore never imports anything HTTP-related.
 */
export enum ErrorKind {
  VALIDATION = 'VALIDATION',
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  /** An external dependency is down or timed out. Retrying later is reasonable. */
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  /** An external dependency rejected our request: a bug or misconfiguration on OUR side. Retrying will not help. */
  PROVIDER_FAILURE = 'PROVIDER_FAILURE',
}

/** One invalid field and everything wrong with it. */
export interface FieldError {
  field: string;
  messages: string[];
}

/**
 * Base class for every failure the business rules can cause on purpose.
 * Subclasses fix their own kind/code/message, e.g. `class EmailAlreadyRegisteredException`.
 */
export abstract class DomainException extends Error {
  protected constructor(
    readonly kind: ErrorKind,
    readonly code: ErrorCode,
    message: string,
    readonly details?: FieldError[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}
