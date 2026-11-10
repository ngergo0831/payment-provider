import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppLogger } from './common/logging/app-logger';
import { AppConfig } from './config/configuration';
import { Environment } from './config/env.validation';
import { setupSwagger } from './swagger.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);

  app.useLogger(new AppLogger(config.get('logLevel', { infer: true }), config.get('logFormat', { infer: true })));

  configureApp(app);

  if (config.get('nodeEnv', { infer: true }) !== Environment.Production) setupSwagger(app);

  app.enableShutdownHooks();

  const port = config.get('port', { infer: true });
  await app.listen(port, '0.0.0.0');

  new Logger('Bootstrap').log(`API listening on port ${port} (${config.get('nodeEnv', { infer: true })})`);
}

void bootstrap();
