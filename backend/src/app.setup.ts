import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { assignRequestId } from './common/http/request-id.middleware';
import { createValidationPipe } from './common/http/validation.pipe';

/**
 * HTTP behaviour shared by the real server (main.ts) and the tests.
 * Tests call this too, so they exercise exactly the middleware, pipe, filter and headers production uses.
 *
 * Order matters: `app.use()` calls made here run before Nest's body parser.
 */
export function configureApp(app: INestApplication): void {
  app.use(assignRequestId);
  // Security headers; also removes `X-Powered-By: Express`, which advertises the framework to attackers.
  // One directive is switched off: `upgrade-insecure-requests` makes browsers load the Swagger page's
  // assets over https, which breaks it on a plain-http dev server (Safari does not exempt localhost).
  // Everything else in helmet's default policy stays on.
  app.use(helmet({ contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': null } } }));
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
