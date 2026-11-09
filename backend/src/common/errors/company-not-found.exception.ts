import { DomainException, ErrorKind } from './domain.exception';
import { ErrorCode } from './error-codes';

export class CompanyNotFoundException extends DomainException {
  constructor() {
    super(ErrorKind.NOT_FOUND, ErrorCode.COMPANY_NOT_FOUND, 'Company not found');
  }
}
