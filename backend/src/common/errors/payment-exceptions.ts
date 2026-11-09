import { DomainException, ErrorKind } from './domain.exception';
import { ErrorCode } from './error-codes';

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
