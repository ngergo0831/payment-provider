import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { DomainException, ErrorKind } from '../errors/domain.exception';
import { ErrorCode } from '../errors/error-codes';
import { ErrorResponse } from '../http/error-response';
import { RequestWithId } from '../http/request-id.middleware';

/**
 * Kind -> HTTP status. Typed as Record<ErrorKind, ...>, so adding a new ErrorKind without
 * deciding its status is a COMPILE error, not a forgotten case discovered in production.
 */
const STATUS_BY_KIND: Record<ErrorKind, HttpStatus> = {
  [ErrorKind.VALIDATION]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorKind.BAD_REQUEST]: HttpStatus.BAD_REQUEST,
  [ErrorKind.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
  [ErrorKind.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorKind.CONFLICT]: HttpStatus.CONFLICT,
  // The provider is down or slow: tell the client to retry shortly.
  [ErrorKind.PROVIDER_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  // The provider rejected OUR request (bad key, bad contract): not fixable by the client. 502 = "bad gateway".
  [ErrorKind.PROVIDER_FAILURE]: HttpStatus.BAD_GATEWAY,
};

/** Framework-raised errors (guards, unknown routes, malformed JSON) get a stable code too. */
const CODE_BY_HTTP_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
};

type NormalisedError = Pick<ErrorResponse, 'statusCode' | 'code' | 'message' | 'details'>;

/**
 * The single place where ANY thrown error becomes an HTTP response.
 *
 *  - DomainException -> status from its kind; its (safe) message is returned
 *  - HttpException   -> raised by the framework itself; its status is kept
 *  - anything else   -> a bug or an outage. The stack is LOGGED, the client only sees a generic 500,
 *                       so no SQL, file paths or secrets can leak through an error message.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();

    const { statusCode, code, message, details } = this.normalise(exception);
    this.log(exception, statusCode, request);

    const body: ErrorResponse = {
      statusCode,
      code,
      message,
      ...(details ? { details } : {}),
      requestId: request.id,
      timestamp: new Date().toISOString(),
    };
    response.status(statusCode).json(body);
  }

  private normalise(exception: unknown): NormalisedError {
    if (exception instanceof DomainException) {
      return {
        statusCode: STATUS_BY_KIND[exception.kind],
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      return {
        statusCode,
        code: CODE_BY_HTTP_STATUS[statusCode] ?? ErrorCode.BAD_REQUEST,
        message: this.httpExceptionMessage(exception),
      };
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
    };
  }

  private httpExceptionMessage(exception: HttpException): string {
    const res = exception.getResponse();
    if (typeof res === 'string') return res;
    const message = (res as { message?: string | string[] }).message;
    return Array.isArray(message) ? message.join('; ') : (message ?? exception.message);
  }

  private log(exception: unknown, statusCode: number, request: RequestWithId): void {
    const context = `[${request.id}] ${request.method} ${request.url} -> ${statusCode}`;
    const isExpectedFailure = exception instanceof DomainException || exception instanceof HttpException;

    if (isExpectedFailure) {
      // Already classified and handled: one line, no stack trace, so real problems stay visible in the noise.
      this.logger.warn(`${context} ${(exception as Error).message}`);
    } else {
      this.logger.error(context, exception instanceof Error ? exception.stack : String(exception));
    }
  }
}
