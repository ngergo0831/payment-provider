import { ErrorCode } from './error-codes';

export enum ErrorKind {
  VALIDATION = 'VALIDATION',
  BAD_REQUEST = 'BAD_REQUEST',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  /** An external dependency is down or timed out. Retrying later is reasonable. */
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  /** An external dependency rejected our request: a bug or misconfiguration on our side. Retrying will not help. */
  PROVIDER_FAILURE = 'PROVIDER_FAILURE',
}

export interface FieldError {
  field: string;
  messages: string[];
}

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
