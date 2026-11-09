import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { AppLogger, LogLevelName } from './app-logger';
import { LogRecord, LogSink } from './log-sink';

class MemorySink extends LogSink {
  readonly records: LogRecord[] = [];
  write(record: LogRecord): void {
    this.records.push(record);
  }
}

function setup(level: LogLevelName = LogLevelName.Debug) {
  const sink = new MemorySink();
  const config = { get: () => level } as unknown as ConfigService<AppConfig, true>;
  return { sink, logger: new AppLogger(sink, config) };
}

describe('AppLogger', () => {
  describe('levels', () => {
    it('drops what is below the configured level (LOG_LEVEL=log hides debug)', () => {
      const { sink, logger } = setup(LogLevelName.Log);

      logger.debug('routine read', 'HTTP');
      logger.verbose('chatter', 'HTTP');
      logger.log('payment started', 'StartPaymentUseCase');
      logger.warn('slow provider', 'StripePaymentProvider');

      expect(sink.records.map((r) => r.level)).toEqual(['log', 'warn']);
    });

    it('LOG_LEVEL=error keeps errors only', () => {
      const { sink, logger } = setup(LogLevelName.Error);

      logger.warn('w', 'X');
      logger.error('e', undefined, 'X');

      expect(sink.records.map((r) => r.level)).toEqual(['error']);
    });
  });

  describe('records', () => {
    it('turns a call into a structured record: time, level, context, message', () => {
      const { sink, logger } = setup();

      logger.log('Payment p1: CREATED -> SUCCEEDED', 'PaymentSynchronizer');

      expect(sink.records).toEqual([
        { time: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/), level: 'log', context: 'PaymentSynchronizer', message: 'Payment p1: CREATED -> SUCCEEDED' },
      ]);
    });

    it("reads Nest's error convention: (message, stack, context)", () => {
      const { sink, logger } = setup();

      logger.error('it broke', 'Error: it broke\n    at somewhere (file.ts:1:1)', 'AllExceptionsFilter');

      expect(sink.records[0]).toMatchObject({ level: 'error', context: 'AllExceptionsFilter', message: 'it broke', stack: expect.stringContaining('at somewhere') });
    });

    it('an error without a stack still gets its context (what `new Logger(X).error(msg)` sends)', () => {
      const { sink, logger } = setup();

      logger.error('no stack here', undefined, 'OutboxDispatcher');

      expect(sink.records[0]).toEqual(expect.objectContaining({ context: 'OutboxDispatcher', message: 'no stack here' }));
      expect(sink.records[0].stack).toBeUndefined();
    });

    it('takes the stack from an Error passed as the message', () => {
      const { sink, logger } = setup();

      logger.error(new TypeError('bad thing'), 'Bootstrap');

      expect(sink.records[0]).toMatchObject({ message: 'TypeError: bad thing', context: 'Bootstrap', stack: expect.stringContaining('TypeError: bad thing') });
    });

    it('writes objects as JSON instead of "[object Object]"', () => {
      const { sink, logger } = setup();

      logger.log({ checked: 3, failed: 0 }, 'ReconcilePaymentsUseCase');

      expect(sink.records[0].message).toBe('{"checked":3,"failed":0}');
    });
  });

  describe('secrets never reach the sink, whoever wrote the line', () => {
    it.each([
      ['a Stripe key quoted (masked) in a library error', 'Invalid API Key provided: sk_test_****************************aB3d', /sk_test_|aB3d/],
      ['a webhook signing secret', 'verifying with whsec_8f3a9c1d2e4b5a6c7d8e9f0a', /whsec_/],
      ['a payment client secret', 'intent pi_3Abc_secret_XyZ123 confirmed', /_secret_/],
      ['a bearer token', 'header was Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', /Bearer ey|eyJ/],
    ])('in the message: %s', (_label, message, forbidden) => {
      const { sink, logger } = setup();

      logger.warn(message, 'Somewhere');

      expect(sink.records[0].message).not.toMatch(forbidden);
      expect(sink.records[0].message).toContain('[redacted]');
    });

    it('in the stack trace of an unexpected error', () => {
      const { sink, logger } = setup();
      const error = new Error('Stripe rejected sk_live_51SECRETKEY');

      logger.error('request failed', error.stack, 'AllExceptionsFilter');

      expect(JSON.stringify(sink.records[0])).not.toMatch(/sk_live_|SECRETKEY/);
    });
  });

  it('is what every `new Logger(...)` in the codebase writes to once installed (as main.ts does)', () => {
    const { sink, logger } = setup();
    Logger.overrideLogger(logger);
    try {
      new Logger('PaymentSynchronizer').log('Payment p1: CREATED -> FAILED (card_declined)');
      new Logger('StripePaymentProvider').error('Stripe paymentIntents.create rejected: sk_test_abc');
    } finally {
      Logger.overrideLogger(false);
    }

    expect(sink.records.map(({ context, message }) => ({ context, message }))).toEqual([
      { context: 'PaymentSynchronizer', message: 'Payment p1: CREATED -> FAILED (card_declined)' },
      { context: 'StripePaymentProvider', message: 'Stripe paymentIntents.create rejected: [redacted]' },
    ]);
  });
});
