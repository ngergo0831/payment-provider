import { jest } from '@jest/globals';
import { AppLogger, LogFormat, LogLevelName } from './app-logger';

const STRIPE_KEY = 'sk_test_51AbCdEfGhIjKlMnOp';
const CLIENT_SECRET = 'pi_3UZxAbc_secret_XyZ123';

function capture(level: LogLevelName, format: LogFormat, write: (logger: AppLogger) => void): string {
  const lines: string[] = [];
  const record = (chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  };
  const spies = [
    jest.spyOn(process.stdout, 'write').mockImplementation(record),
    jest.spyOn(process.stderr, 'write').mockImplementation(record),
  ];
  try {
    write(new AppLogger(level, format));
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
  return lines.join('');
}

describe('AppLogger', () => {
  it('drops what is below the configured level', () => {
    const output = capture(LogLevelName.Log, LogFormat.Text, (logger) => {
      logger.debug('routine read', 'HTTP');
      logger.log('payment started', 'StartPaymentUseCase');
    });

    expect(output).toContain('payment started');
    expect(output).not.toContain('routine read');
  });

  it.each([LogFormat.Text, LogFormat.Json])('removes secrets from messages and stack traces (%s)', (format) => {
    const output = capture(LogLevelName.Debug, format, (logger) => {
      logger.warn(`Stripe said: Invalid API Key provided: ${STRIPE_KEY}`, 'StripePaymentProvider');
      logger.error(`failed for ${CLIENT_SECRET}`, `Error: boom ${STRIPE_KEY}\n    at somewhere`, 'X');
    });

    expect(output).toContain('Invalid API Key provided: [redacted]');
    expect(output).not.toContain(STRIPE_KEY);
    expect(output).not.toContain(CLIENT_SECRET);
  });

  it('writes one JSON object per line in json format', () => {
    const output = capture(LogLevelName.Log, LogFormat.Json, (logger) => logger.log('hello', 'Ctx'));

    expect(JSON.parse(output.trim())).toMatchObject({ level: 'log', context: 'Ctx', message: 'hello' });
  });
});
