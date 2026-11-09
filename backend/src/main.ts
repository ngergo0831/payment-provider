import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfig } from './config/configuration';
import { setupSwagger } from './swagger.setup';

async function bootstrap(): Promise<void> {
  // rawBody: webhook signatures are verified over the exact bytes the provider sent, so they must be kept.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  setupSwagger(app);
  // On SIGTERM (docker stop, a deploy) run the shutdown hooks: finish the background jobs in progress, stop taking
  // requests, then close the database pool. Without this, the process is killed mid-work.
  app.enableShutdownHooks();
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const port = config.get('port', { infer: true });

  // 0.0.0.0 so the server is reachable from outside a container later on.
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on port ${port} (${config.get('nodeEnv', { infer: true })})`);
}

void bootstrap();
