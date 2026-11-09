import type { LogLevel } from '@nestjs/common';
import { LogRecord, LogSink } from './log-sink';

export enum LogFormat {
  /** Readable in a terminal: for development. */
  Text = 'text',
  /** One JSON object per line: what CloudWatch Logs Insights, Datadog or ELK parse and query by field. */
  Json = 'json',
}

type Output = Pick<NodeJS.WriteStream, 'write'>;

const TO_STDERR: ReadonlySet<LogLevel> = new Set(['fatal', 'error', 'warn']);

/**
 * Writes one line per record: warnings and errors to stderr, the rest to stdout.
 *
 * In a container this is also the usual road to CloudWatch: with LOG_FORMAT=json the platform (ECS's awslogs driver,
 * Fluent Bit, the CloudWatch agent) ships stdout as structured events, and the application needs no AWS code at all.
 */
export class ConsoleLogSink extends LogSink {
  constructor(
    private readonly format: LogFormat,
    private readonly stdout: Output = process.stdout,
    private readonly stderr: Output = process.stderr,
  ) {
    super();
  }

  write(record: LogRecord): void {
    const line = this.format === LogFormat.Json ? JSON.stringify(record) : asText(record);
    (TO_STDERR.has(record.level) ? this.stderr : this.stdout).write(`${line}\n`);
  }
}

function asText({ time, level, context, message, stack }: LogRecord): string {
  const line = `${time} ${level.toUpperCase().padEnd(5)} ${context ? `[${context}] ` : ''}${message}`;
  return stack ? `${line}\n${stack}` : line;
}
