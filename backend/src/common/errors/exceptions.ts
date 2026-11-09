import { DomainException, ErrorKind, FieldError } from './domain.exception';
import { ErrorCode } from './error-codes';

/**
 * Every failure the application raises on purpose, in one place. Each one fixes its own kind (which the exception
 * filter maps to an HTTP status), its stable code, and a message that is safe to show to a client.
 */

// ---- input ----

/** The request broke the input rules. Carries which fields and why, so the UI can mark them. */
export class ValidationFailedException extends DomainException {
  constructor(details: FieldError[]) {
    super(ErrorKind.VALIDATION, ErrorCode.VALIDATION_FAILED, 'Request validation failed', details);
  }
}

// ---- onboarding ----

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

// ---- payments ----

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

/** The payment provider could not be reached or timed out. Nothing was charged; the client may retry shortly. */
export class PaymentProviderUnavailableException extends DomainException {
  constructor() {
    super(
      ErrorKind.PROVIDER_UNAVAILABLE,
      ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
      'The payment service is temporarily unavailable. Nothing was charged. Please try again shortly.',
    );
  }
}

/** The payment provider rejected our request (configuration or contract problem). The client cannot fix this. */
export class PaymentProviderFailureException extends DomainException {
  constructor() {
    super(ErrorKind.PROVIDER_FAILURE, ErrorCode.PAYMENT_PROVIDER_ERROR, 'The payment service could not process the request.');
  }
}

/** A webhook did not carry a valid signature, so it cannot be trusted. */
export class InvalidWebhookSignatureException extends DomainException {
  constructor() {
    super(ErrorKind.BAD_REQUEST, ErrorCode.INVALID_WEBHOOK_SIGNATURE, 'Webhook signature verification failed');
  }
}
