import { buildOpenApiDocument, DOCS_PATH, setupSwagger } from '../src/swagger.setup';
import { createTestApp, TestApp } from './support/test-app';

/**
 * Runs against the WHOLE application, so as endpoints are added in later tasks these checks
 * automatically cover them: an undocumented error response or a missing description fails here.
 */
describe('Swagger / OpenAPI', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp(setupSwagger);
  });
  afterAll(async () => {
    await t.close();
  });

  describe('the generated document', () => {
    it('describes the endpoints that exist', () => {
      const doc = buildOpenApiDocument(t.app);
      expect(doc.info.title).toBe('Payment Service API');
      expect(Object.keys(doc.paths)).toContain('/health');
      expect(doc.paths['/health'].get?.tags).toEqual(['health']);
    });

    it('documents both outcomes of /health: ready (200) and database down (503)', () => {
      const responses = buildOpenApiDocument(t.app).paths['/health'].get?.responses ?? {};
      expect(Object.keys(responses)).toEqual(expect.arrayContaining(['200', '503']));
    });

    it('documents the shared error shape, with every field a client relies on', () => {
      const schema = buildOpenApiDocument(t.app).components?.schemas?.ErrorResponse as { properties: Record<string, unknown> };
      expect(Object.keys(schema.properties).sort()).toEqual(
        ['code', 'details', 'message', 'requestId', 'statusCode', 'timestamp'].sort(),
      );
    });

    it('lists the error codes as an enum, so clients can generate types from them', () => {
      const schema = buildOpenApiDocument(t.app).components?.schemas?.ErrorResponse as {
        properties: { code: { enum: string[] } };
      };
      expect(schema.properties.code.enum).toEqual(expect.arrayContaining(['VALIDATION_FAILED', 'INTERNAL_ERROR']));
    });

    it('gives EVERY operation a default error response, so no endpoint is documented as infallible', () => {
      const doc = buildOpenApiDocument(t.app);
      const operations = Object.values(doc.paths).flatMap((path) => Object.values(path));

      expect(operations.length).toBeGreaterThan(0);
      for (const operation of operations) {
        expect((operation as { responses: Record<string, unknown> }).responses.default).toMatchObject({
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        });
      }
    });
  });

  describe('the served docs', () => {
    it('serves the interactive UI at /docs and the raw document at /docs-json', async () => {
      const ui = await t.http.get(`/${DOCS_PATH}`).expect(200);
      expect(ui.text).toContain('swagger-ui');

      const json = await t.http.get(`/${DOCS_PATH}-json`).expect(200);
      expect(json.body.openapi).toMatch(/^3\./);
      expect(json.body.paths['/health']).toBeDefined();
    });

    it('keeps Content-Security-Policy on, but without upgrade-insecure-requests (which breaks plain-http dev)', async () => {
      const res = await t.http.get(`/${DOCS_PATH}`).expect(200);
      const csp = res.headers['content-security-policy'];

      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).not.toContain('upgrade-insecure-requests');
    });

    it('only loads scripts from files, never inline (an inline script would be blocked by the CSP)', async () => {
      const res = await t.http.get(`/${DOCS_PATH}`).expect(200);
      const inlineScripts = res.text.match(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/g) ?? [];
      expect(inlineScripts).toEqual([]);
    });
  });
});
