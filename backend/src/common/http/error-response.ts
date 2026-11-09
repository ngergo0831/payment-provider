import { FieldError } from '../errors/domain.exception';
import { ErrorCode } from '../errors/error-codes';

/**
 * The ONE shape of every error response in the API, so clients write a single error handler.
 * (Swagger annotations are added to this class in the Swagger task.)
 */
export class ErrorResponse {
  /** HTTP status, repeated in the body for clients/logs that lose the response line. */
  statusCode: number;
  /** Stable machine-readable code: branch on this, not on `message`. */
  code: ErrorCode;
  /** Human-readable, safe to show to a user. Never contains internals. */
  message: string;
  /** Present for validation failures: which fields are wrong and why. */
  details?: FieldError[];
  /** Correlation id, also in the `x-request-id` header and in the server logs. */
  requestId: string;
  timestamp: string;
}
