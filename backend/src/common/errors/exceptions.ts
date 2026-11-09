import { DomainException, ErrorKind, FieldError } from './domain.exception';
import { ErrorCode } from './error-codes';

export class ValidationFailedException extends DomainException {
  constructor(details: FieldError[]) {
    super(ErrorKind.VALIDATION, ErrorCode.VALIDATION_FAILED, 'Request validation failed', details);
  }
}

export class EmailAlreadyRegisteredException extends DomainException {
  constructor() {
    super(ErrorKind.CONFLICT, ErrorCode.EMAIL_ALREADY_REGISTERED, 'An account with this email already exists');
  }
}

export class CompanyNotFoundException extends DomainException {
  constructor() {
    super(ErrorKind.NOT_FOUND, ErrorCode.COMPANY_NOT_FOUND, 'Company not found');
  }
}

export class CompanyAlreadyActiveException extends DomainException {
  constructor() {
    super(ErrorKind.CONFLICT, ErrorCode.COMPANY_ALREADY_ACTIVE, 'This account is already active; no payment is required');
  }
}

export class PaymentNotFoundException extends DomainException {
  constructor() {
    super(ErrorKind.NOT_FOUND, ErrorCode.PAYMENT_NOT_FOUND, 'Payment not found');
  }
}

export class PaymentProviderUnavailableException extends DomainException {
  constructor() {
    super(
      ErrorKind.PROVIDER_UNAVAILABLE,
      ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
      'The payment service is temporarily unavailable. Nothing was charged. Please try again shortly.',
    );
  }
}

export class PaymentProviderFailureException extends DomainException {
  constructor() {
    super(ErrorKind.PROVIDER_FAILURE, ErrorCode.PAYMENT_PROVIDER_ERROR, 'The payment service could not process the request.');
  }
}

export class InvalidWebhookSignatureException extends DomainException {
  constructor() {
    super(ErrorKind.BAD_REQUEST, ErrorCode.INVALID_WEBHOOK_SIGNATURE, 'Webhook signature verification failed');
  }
}
