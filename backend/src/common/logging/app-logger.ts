import { Injectable, LoggerService, LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { LogSink } from './log-sink';
import { redactSecrets } from './redact';

/** LOG_LEVEL: the least severe level still written. Each includes everything more severe. */
export enum LogLevelName {
  Error = 'error',
  Warn = 'warn',
  Log = 'log',
  Debug = 'debug',
}

const SEVERITY: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug'];

/**
 * The application's logger. main.ts installs it with `app.useLogger(...)`, so every `new Logger('Context')` call in the
 * codebase, and Nest's own messages, come through here. That makes this the one place that:
 *  - drops what is below the configured level (LOG_LEVEL)
 *  - removes secrets from every message and stack trace, whoever wrote them (a library quoting a key in an error,
 *    a careless line in a future feature), so no caller has to remember to
 *  - turns the call into a structured record and hands it to the LogSink
 */
@Injectable()
export class AppLogger implements LoggerService {
  private readonly enabled: ReadonlySet<LogLevel>;

  constructor(
    private readonly sink: LogSink,
    config: ConfigService<AppConfig, true>,
  ) {
    const lowest: LogLevel = config.get('logLevel', { infer: true });
    this.enabled = new Set(SEVERITY.slice(0, SEVERITY.indexOf(lowest) + 1));
  }

  log(message: unknown, ...params: unknown[]): void {
    this.write('log', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('verbose', message, params);
  }

  private write(level: LogLevel, message: unknown, params: unknown[]): void {
    if (!this.enabled.has(level)) return;

    const { context, stack } = readParams(level, params);
    const trace = stack ?? (message instanceof Error ? message.stack : undefined);
    this.sink.write({
      time: new Date().toISOString(),
      level,
      ...(context ? { context } : {}),
      message: redactSecrets(describe(message)),
      ...(trace ? { stack: redactSecrets(trace) } : {}),
    });
  }
}

/**
 * Nest's calling convention: `(message, context)` for every level, and `(message, stack, context)` for errors.
 * A `Logger` with a context always passes it LAST, so: the last string is the context, an error's first one the stack.
 */
function readParams(level: LogLevel, params: unknown[]): { context?: string; stack?: string } {
  const strings = params.filter((param): param is string => typeof param === 'string');
  const isError = level === 'error' || level === 'fatal';
  if (!isError) return { context: strings.at(-1) };

  // An error with one string: a stack trace has line breaks, a context (a class name) does not.
  if (params.length === 1 && strings.length === 1) return strings[0].includes('\n') ? { stack: strings[0] } : { context: strings[0] };
  const context = typeof params.at(-1) === 'string' ? (params.at(-1) as string) : undefined;
  const stack = typeof params[0] === 'string' && params.length > 1 ? params[0] : undefined;
  return { context, stack };
}

function describe(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return `${message.name}: ${message.message}`;
  return JSON.stringify(message) ?? String(message);
}
