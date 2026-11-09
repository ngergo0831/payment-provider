import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfig } from './config/configuration';
import { setupSwagger } from './swagger.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  setupSwagger(app);
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const port = config.get('port', { infer: true });

  // 0.0.0.0 so the server is reachable from outside a container later on.
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on port ${port} (${config.get('nodeEnv', { infer: true })})`);
}

void bootstrap();
