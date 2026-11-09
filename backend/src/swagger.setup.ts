import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ErrorResponse } from './common/http/error-response';

export const DOCS_PATH = 'docs';

const DEFAULT_ERROR_RESPONSE = {
  description:
    'Any error. Always this shape: branch on `code`, show `message`, quote `requestId` when reporting a problem. ' +
    'Specific statuses an endpoint can return are listed above.',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
};

/**
 * Builds the OpenAPI document from the controllers and DTO decorators.
 * Separate from `setupSwagger` so tests can inspect the document without serving it.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Payment Service API')
    .setDescription(
      'Self-serve onboarding: a company registers, pays for its plan, and is activated.\n\n' +
        '**Errors.** Every failure uses one shape (see `ErrorResponse`). Branch on `code`; quote `requestId` when reporting a problem.',
    )
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config, { extraModels: [ErrorResponse] });

  // Every endpoint can fail in the standard way (unknown route, bad JSON, unexpected error...).
  // OpenAPI's `default` response covers "any status not listed", so it is added once here instead of
  // being repeated on every endpoint. Endpoints still list their own specific statuses (409, 503...).
  for (const path of Object.values(document.paths)) {
    for (const operation of Object.values(path)) {
      if (operation && typeof operation === 'object' && 'responses' in operation && !operation.responses.default) {
        operation.responses.default = DEFAULT_ERROR_RESPONSE;
      }
    }
  }
  return document;
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup(DOCS_PATH, app, buildOpenApiDocument(app));
}
