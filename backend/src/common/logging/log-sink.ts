import type { LogLevel } from '@nestjs/common';

export interface LogRecord {
  time: string;
  level: LogLevel;
  context?: string;
  message: string;
  stack?: string;
}

export abstract class LogSink {
  abstract write(record: LogRecord): void;
}
