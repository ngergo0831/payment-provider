import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../config/configuration';
import { AuthTokenService, JWT_ISSUER } from './auth-token.service';
import { JwtStrategy } from './jwt.strategy';

const SECRET = 'unit-test-secret-that-is-at-least-32-chars';
const user = { userId: 'user-1', companyId: 'company-1' };

const jwtService = (expiresIn: string) =>
  new JwtService({ secret: SECRET, signOptions: { algorithm: 'HS256', expiresIn: expiresIn as never } });

describe('AuthTokenService', () => {
  it('puts the user id in `sub`, the company in a custom claim, and names its issuer', async () => {
    const service = jwtService('1h');
    const token = await new AuthTokenService(service).issue(user);

    expect(service.decode(token)).toMatchObject({ sub: 'user-1', companyId: 'company-1', iss: JWT_ISSUER });
  });

  it('honours the configured lifetime', async () => {
    const service = jwtService('30m');
    const token = await new AuthTokenService(service).issue(user);
    const { iat, exp } = service.decode(token) as { iat: number; exp: number };
    expect(exp - iat).toBe(30 * 60);
  });

  it('signs with HS256, and the token verifies with the same secret only', async () => {
    const service = jwtService('1h');
    const token = await new AuthTokenService(service).issue(user);

    await expect(service.verifyAsync(token)).resolves.toBeDefined();
    await expect(new JwtService({ secret: 'a-completely-different-secret-of-32-chars!' }).verifyAsync(token)).rejects.toThrow();
    expect(JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())).toMatchObject({ alg: 'HS256' });
  });
});

describe('JwtStrategy.validate', () => {
  const config = { get: () => ({ secret: SECRET, expiresIn: '1h' }) } as unknown as ConfigService<AppConfig, true>;
  const strategy = new JwtStrategy(config);

  it('turns valid claims into the AuthenticatedUser the app uses', () => {
    expect(strategy.validate({ sub: 'user-1', companyId: 'company-1' })).toEqual(user);
  });

  it.each([
    ['no company', { sub: 'u' }],
    ['no subject', { companyId: 'c' }],
    ['a non-string company', { sub: 'u', companyId: 42 }],
    ['empty claims', {}],
  ])('refuses a correctly signed token with %s, so `undefined` never reaches a query as a company id', (_label, claims) => {
    expect(() => strategy.validate(claims)).toThrow(UnauthorizedException);
  });
});
