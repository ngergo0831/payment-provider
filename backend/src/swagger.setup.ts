import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ErrorResponse } from './common/http/error-response';

type OperationObject = NonNullable<OpenAPIObject['paths'][string]['get']>;

export const DOCS_PATH = 'docs';

const DEFAULT_ERROR_RESPONSE = {
  description:
    'Any error. Always this shape: branch on `code`, show `message`, quote `requestId` when reporting a problem. ' +
    'Specific statuses an endpoint can return are listed above.',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
};

function isOperation(value: unknown): value is OperationObject {
  return typeof value === 'object' && value !== null && 'responses' in value;
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Payment Service API')
    .setDescription(
      'Self-serve onboarding: a company registers, pays for its plan, and is activated.\n\n' +
        '**Errors.** Every failure uses one shape (see `ErrorResponse`). Branch on `code`; quote `requestId` when reporting a problem.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config, { extraModels: [ErrorResponse] });

  for (const path of Object.values(document.paths)) {
    for (const operation of Object.values(path) as unknown[]) {
      if (isOperation(operation) && !operation.responses.default) {
        operation.responses.default = DEFAULT_ERROR_RESPONSE;
      }
    }
  }
  return document;
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup(DOCS_PATH, app, buildOpenApiDocument(app));
}
