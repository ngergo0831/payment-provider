import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);

  // 0.0.0.0 so the server is reachable from outside a container later on.
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on port ${port}`);
}

void bootstrap();
