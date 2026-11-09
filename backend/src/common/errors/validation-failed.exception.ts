import { DomainException, ErrorKind, FieldError } from './domain.exception';
import { ErrorCode } from './error-codes';

/** The request body/params broke the input rules. Carries which fields and why, so the UI can mark them. */
export class ValidationFailedException extends DomainException {
  constructor(details: FieldError[]) {
    super(ErrorKind.VALIDATION, ErrorCode.VALIDATION_FAILED, 'Request validation failed', details);
  }
}
