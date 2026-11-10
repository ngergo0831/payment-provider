import { DomainException, ErrorKind } from '../../common/errors/domain.exception';
import { ErrorCode } from '../../common/errors/error-codes';

/**
 * Our record of a payment and the provider's disagree in a way no retry can fix (a different amount, a different
 * provider payment). It needs a person, so it is logged as an error and not retried. `reason` is for the logs only.
 */
export class PaymentRecordConflictException extends DomainException {
  constructor(
    readonly paymentId: string,
    readonly reason: string,
  ) {
    super(ErrorKind.PROVIDER_FAILURE, ErrorCode.PAYMENT_PROVIDER_ERROR, 'The payment service could not process the request.');
  }
}
