import { jest } from '@jest/globals';
import { Body, Controller, Get, INestApplication, Logger, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsEmail, IsString, Length, ValidateNested } from 'class-validator';
import request from 'supertest';
import { configureApp } from '../app.setup';
import { AppModule } from '../app.module';
import { DomainException, ErrorKind } from './errors/domain.exception';
import { ErrorCode } from './errors/error-codes';

// ---- test-only fixtures: a controller that triggers every kind of failure on demand ----

class CompanyDto {
  @IsString()
  @Length(2, 50)
  name: string;
}

class SignUpDto {
  @IsEmail()
  email: string;

  @ValidateNested()
  @Type(() => CompanyDto)
  company: CompanyDto;
}

class AlreadyExistsException extends DomainException {
  constructor() {
    super(ErrorKind.CONFLICT, ErrorCode.BAD_REQUEST, 'That thing already exists');
  }
}

class MissingThingException extends DomainException {
  constructor() {
    super(ErrorKind.NOT_FOUND, ErrorCode.NOT_FOUND, 'No such thing');
  }
}

@Controller('test')
class FailureController {
  @Post('validate')
  validate(@Body() body: SignUpDto): SignUpDto {
    return body;
  }

  @Get('conflict')
  conflict(): never {
    throw new AlreadyExistsException();
  }

  @Get('missing')
  missing(): never {
    throw new MissingThingException();
  }

  @Get('crash')
  crash(): never {
    throw new Error('connection to db-prod-3 refused, password=hunter2');
  }
}

// ---- tests ----

describe('global error handling', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let warn: ReturnType<typeof jest.spyOn>;
  let error: ReturnType<typeof jest.spyOn>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [FailureController] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
  });

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => app.close());

  describe('the error envelope', () => {
    it('has the same shape for every failure', async () => {
      const res = await http.get('/test/missing').expect(404);
      expect(res.body).toEqual({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'No such thing',
        requestId: expect.any(String),
        timestamp: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      });
    });

    it('maps a domain exception kind to its HTTP status (CONFLICT -> 409)', async () => {
      const res = await http.get('/test/conflict').expect(409);
      expect(res.body.message).toBe('That thing already exists');
    });

    it('answers unknown routes in the same envelope', async () => {
      expect((await http.get('/nope').expect(404)).body).toMatchObject({ code: 'NOT_FOUND', requestId: expect.any(String) });
    });

    it('answers malformed JSON in the same envelope, INCLUDING the request id (body parsing fails before routing)', async () => {
      const res = await http.post('/test/validate').set('Content-Type', 'application/json').send('{"email":').expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: expect.any(String),
        requestId: res.headers['x-request-id'], // exact match: present, and equal to the header
        timestamp: expect.any(String),
      });
    });
  });

  describe('validation', () => {
    it('accepts valid input', async () => {
      await http.post('/test/validate').send({ email: 'a@b.co', company: { name: 'Acme' } }).expect(201);
    });

    it('returns 422 with a field-level list, including nested fields', async () => {
      const res = await http.post('/test/validate').send({ email: 'nope', company: { name: 'A' } }).expect(422);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          { field: 'email', messages: ['email must be an email'] },
          { field: 'company.name', messages: [expect.stringContaining('longer than or equal to 2')] },
        ]),
      );
    });

    it('rejects unknown fields instead of silently ignoring them', async () => {
      const res = await http
        .post('/test/validate')
        .send({ email: 'a@b.co', company: { name: 'Acme' }, role: 'ADMIN' })
        .expect(422);

      expect(res.body.details).toEqual(expect.arrayContaining([{ field: 'role', messages: ['property role should not exist'] }]));
    });
  });

  describe('unexpected errors', () => {
    it('returns a generic 500 and leaks nothing from the original error', async () => {
      const res = await http.get('/test/crash').expect(500);

      expect(res.body).toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
      expect(JSON.stringify(res.body)).not.toMatch(/db-prod-3|hunter2|\.ts:/);
    });

    it('logs the full stack server-side, tagged with the request id, so it can still be diagnosed', async () => {
      const res = await http.get('/test/crash').expect(500);

      const [context, stack] = error.mock.calls[0] as [string, string];
      expect(context).toContain(res.body.requestId);
      expect(stack).toContain('hunter2'); // present in the LOG only
    });

    it('logs expected failures as one warning line, without a stack trace', async () => {
      await http.get('/test/missing').expect(404);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
    });
  });

  describe('request id', () => {
    it('generates one, returns it in the header, and uses the same value in the error body', async () => {
      const res = await http.get('/test/missing').expect(404);

      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.requestId).toBe(res.headers['x-request-id']);
    });

    it('reuses a safe id supplied by the caller (e.g. an API gateway)', async () => {
      const res = await http.get('/health').set('x-request-id', 'gateway-trace_42.a').expect(200);
      expect(res.headers['x-request-id']).toBe('gateway-trace_42.a');
    });

    it.each([
      ['spaces and symbols', 'bad id; drop table'],
      ['too long', 'x'.repeat(200)],
    ])('replaces an unsafe caller-supplied id (%s), which could be used to forge log lines', async (_label, unsafe) => {
      const res = await http.get('/health').set('x-request-id', unsafe).expect(200);
      expect(res.headers['x-request-id']).not.toBe(unsafe);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('security headers (helmet)', () => {
    it('does not advertise the framework and sets basic protections', async () => {
      const res = await http.get('/health').expect(200);

      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });
});
