import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { redactSecrets } from './redact';

export enum LogLevelName {
  Error = 'error',
  Warn = 'warn',
  Log = 'log',
  Debug = 'debug',
}

export enum LogFormat {
  Text = 'text',
  Json = 'json',
}

const SEVERITY: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug'];

/** Nest's console logger, with known secret shapes removed from every line it prints. */
export class AppLogger extends ConsoleLogger {
  constructor(level: LogLevelName, format: LogFormat) {
    super({ logLevels: SEVERITY.slice(0, SEVERITY.indexOf(level) + 1), json: format === LogFormat.Json });
  }

  protected override formatMessage(
    logLevel: LogLevel,
    message: unknown,
    pidMessage: string,
    formattedLogLevel: string,
    contextMessage: string,
    timestampDiff: string,
    params?: Record<string, unknown>,
  ): string {
    return redactSecrets(super.formatMessage(logLevel, message, pidMessage, formattedLogLevel, contextMessage, timestampDiff, params));
  }

  protected override stringifyJsonLogObject(logObject: Record<string, unknown>): string {
    return redactSecrets(super.stringifyJsonLogObject(logObject));
  }

  protected override printStackTrace(stack: string): void {
    super.printStackTrace(stack && redactSecrets(stack));
  }
}
