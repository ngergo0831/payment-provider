import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { DomainException, ErrorKind } from '../errors/domain.exception';
import { ErrorCode } from '../errors/error-codes';
import { ErrorResponse } from '../http/error-response';
import { RequestWithId } from '../http/request-id.middleware';

const STATUS_BY_KIND: Record<ErrorKind, HttpStatus> = {
  [ErrorKind.VALIDATION]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorKind.BAD_REQUEST]: HttpStatus.BAD_REQUEST,
  [ErrorKind.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
  [ErrorKind.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorKind.CONFLICT]: HttpStatus.CONFLICT,
  [ErrorKind.PROVIDER_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  [ErrorKind.PROVIDER_FAILURE]: HttpStatus.BAD_GATEWAY,
};

const CODE_BY_HTTP_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
};

type NormalisedError = Pick<ErrorResponse, 'statusCode' | 'code' | 'message' | 'details'>;

const UNEXPECTED_MESSAGE = 'An unexpected error occurred';

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
    if (isClientHttpError(exception)) {
      const statusCode = exception.getStatus();
      return {
        statusCode,
        code: CODE_BY_HTTP_STATUS[statusCode] ?? ErrorCode.BAD_REQUEST,
        message: this.httpExceptionMessage(exception),
      };
    }
    return {
      statusCode: exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: UNEXPECTED_MESSAGE,
    };
  }

  private httpExceptionMessage(exception: HttpException): string {
    const res = exception.getResponse();
    if (typeof res === 'string') return res;
    const message = (res as { message?: string | string[] }).message;
    return Array.isArray(message) ? message.join('; ') : (message ?? exception.message);
  }

  private log(exception: unknown, statusCode: number, request: RequestWithId): void {
    // The path only: the query string can carry personal data (?email=...).
    const context = `[${request.id}] ${request.method} ${request.path} -> ${statusCode}`;

    if (exception instanceof DomainException) {
      this.logger.warn(`${context} ${exception.message}`);
    } else if (isClientHttpError(exception)) {
      // The framework's message can quote the request: a malformed JSON body gives `Unexpected token 'e', "email=jane"...`.
      // So log WHAT KIND of error it was, never its text.
      this.logger.warn(`${context} ${exception.constructor.name}`);
    } else {
      this.logger.error(context, exception instanceof Error ? exception.stack : String(exception));
    }
  }
}

/** A framework error the CLIENT caused (4xx). A framework 5xx is our fault and is treated like any unexpected error. */
function isClientHttpError(exception: unknown): exception is HttpException {
  return exception instanceof HttpException && exception.getStatus() < HttpStatus.INTERNAL_SERVER_ERROR;
}
