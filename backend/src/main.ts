import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppLogger } from './common/logging/app-logger';
import { AppConfig } from './config/configuration';
import { setupSwagger } from './swagger.setup';

async function bootstrap(): Promise<void> {
  // bufferLogs: start-up messages wait until our logger is installed, so they are filtered and redacted too.
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(AppLogger));
  configureApp(app);
  setupSwagger(app);
  app.enableShutdownHooks();
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const port = config.get('port', { infer: true });

  // 0.0.0.0 so the server is reachable from outside a container later on.
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on port ${port} (${config.get('nodeEnv', { infer: true })})`);
}

void bootstrap();
