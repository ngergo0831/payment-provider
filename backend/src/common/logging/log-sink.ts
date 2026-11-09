import type { LogLevel } from '@nestjs/common';

/** One log entry, already filtered by level and scrubbed of secrets: a sink only has to deliver it. */
export interface LogRecord {
  /** ISO 8601, UTC. */
  time: string;
  level: LogLevel;
  /** Who wrote it, e.g. `PaymentSynchronizer` (the name given to `new Logger(...)`). */
  context?: string;
  message: string;
  stack?: string;
}

/**
 * Where log records go: the console, CloudWatch, a file, a test's memory.
 *
 * The port of the logging module: AppLogger decides WHAT is logged, a sink only decides WHERE it goes. Sending logs
 * somewhere new means one new implementation, bound in LoggingModule; no code that logs has to change.
 * (An abstract class rather than an interface, so it doubles as the Nest injection token.)
 */
export abstract class LogSink {
  abstract write(record: LogRecord): void;
}
