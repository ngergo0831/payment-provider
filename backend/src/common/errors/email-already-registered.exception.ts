import { DomainException, ErrorKind } from './domain.exception';
import { ErrorCode } from './error-codes';

export class EmailAlreadyRegisteredException extends DomainException {
  constructor() {
    super(ErrorKind.CONFLICT, ErrorCode.EMAIL_ALREADY_REGISTERED, 'An account with this email already exists');
  }
}
