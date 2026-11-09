import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { AppLogger } from './app-logger';
import { ConsoleLogSink } from './console-log-sink';
import { LogSink } from './log-sink';

/**
 * Everything about logging, in one module.
 *
 * AppLogger (installed in main.ts) receives every log call in the app, filters it by level and removes secrets.
 * The LogSink bound here decides where the records go. To send them somewhere else, e.g. straight to CloudWatch
 * with @aws-sdk/client-cloudwatch-logs, write a `CloudWatchLogSink extends LogSink` and bind it below instead:
 * no code that logs changes. (In a container the simpler route is LOG_FORMAT=json and letting the platform ship stdout.)
 */
@Module({
  providers: [
    {
      provide: LogSink,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => new ConsoleLogSink(config.get('logFormat', { infer: true })),
    },
    AppLogger,
  ],
})
export class LoggingModule {}
