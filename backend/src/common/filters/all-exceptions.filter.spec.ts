import { jest } from '@jest/globals';
import { ArgumentsHost, HttpException, HttpStatus, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PaymentProviderUnavailableException } from '../errors/exceptions';
import { ErrorCode } from '../errors/error-codes';
import { AllExceptionsFilter } from './all-exceptions.filter';

function handle(exception: unknown) {
  const sent: { status?: number; body?: Record<string, unknown> } = {};
  const response = {
    status: (status: number) => {
      sent.status = status;
      return response;
    },
    json: (body: Record<string, unknown>) => void (sent.body = body),
  };
  const request = { id: 'req-1', method: 'POST', url: '/payments' };
  const host = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);
  return sent;
}

describe('AllExceptionsFilter', () => {
  let error: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps a domain 5xx (the provider is down) as an expected, classified failure', () => {
    const { status, body } = handle(new PaymentProviderUnavailableException());

    expect(status).toBe(503);
    expect(body?.code).toBe(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE);
    expect(error).not.toHaveBeenCalled();
  });

  it('keeps the status and message of a framework 4xx', () => {
    const { status, body } = handle(new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS));

    expect(status).toBe(429);
    expect(body).toMatchObject({ code: ErrorCode.TOO_MANY_REQUESTS, message: 'slow down' });
  });

  it('treats a framework 5xx as our fault: generic message, INTERNAL_ERROR, logged with its stack', () => {
    const { status, body } = handle(new ServiceUnavailableException('pool exhausted at db-internal-7:5432'));

    expect(status).toBe(503);
    expect(body).toMatchObject({ code: ErrorCode.INTERNAL_ERROR, message: 'An unexpected error occurred' });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('-> 503'), expect.stringContaining('ServiceUnavailableException'));
  });
});
