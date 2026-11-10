import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { assignRequestId } from './common/http/request-id.middleware';
import { logRequests } from './common/logging/access-log';
import { createValidationPipe } from './common/http/validation.pipe';

export function configureApp(app: INestApplication): void {
  app.use(assignRequestId);
  app.use(logRequests);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': null } } }));
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
