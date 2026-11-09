import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../config/configuration';
import { UserRole } from '../onboarding/domain/user.entity';
import { JwtTokenIssuer } from './infrastructure/jwt-token-issuer';
import { JWT_ISSUER } from './infrastructure/jwt.constants';
import { JwtStrategy } from './infrastructure/jwt.strategy';

const SECRET = 'unit-test-secret-that-is-at-least-32-chars';
const user = { userId: 'user-1', companyId: 'company-1', role: UserRole.ADMIN };

const jwtService = (expiresIn: string) =>
  new JwtService({ secret: SECRET, signOptions: { algorithm: 'HS256', expiresIn: expiresIn as never } });

describe('JwtTokenIssuer', () => {
  it('puts the user id in `sub`, the company and role in custom claims, and names its issuer', async () => {
    const service = jwtService('1h');
    const { accessToken, tokenType } = await new JwtTokenIssuer(service).issue(user);

    expect(tokenType).toBe('Bearer');
    expect(service.decode(accessToken)).toMatchObject({ sub: 'user-1', companyId: 'company-1', role: 'ADMIN', iss: JWT_ISSUER });
  });

  it('honours the configured lifetime', async () => {
    const service = jwtService('30m');
    const { accessToken } = await new JwtTokenIssuer(service).issue(user);
    const { iat, exp } = service.decode(accessToken) as { iat: number; exp: number };
    expect(exp - iat).toBe(30 * 60);
  });

  it('signs with HS256, and the token verifies with the same secret only', async () => {
    const service = jwtService('1h');
    const { accessToken } = await new JwtTokenIssuer(service).issue(user);

    await expect(service.verifyAsync(accessToken)).resolves.toBeDefined();
    await expect(new JwtService({ secret: 'a-completely-different-secret-of-32-chars!' }).verifyAsync(accessToken)).rejects.toThrow();
    expect(JSON.parse(Buffer.from(accessToken.split('.')[0], 'base64url').toString())).toMatchObject({ alg: 'HS256' });
  });
});

describe('JwtStrategy.validate', () => {
  const config = { get: () => ({ secret: SECRET, expiresIn: '1h' }) } as unknown as ConfigService<AppConfig, true>;
  const strategy = new JwtStrategy(config);

  it('turns valid claims into the AuthenticatedUser the app uses', () => {
    expect(strategy.validate({ sub: 'user-1', companyId: 'company-1', role: UserRole.ADMIN })).toEqual(user);
  });

  it.each([
    ['no company', { sub: 'u', role: UserRole.ADMIN }],
    ['no subject', { companyId: 'c', role: UserRole.ADMIN }],
    ['no role', { sub: 'u', companyId: 'c' }],
    ['an unknown role', { sub: 'u', companyId: 'c', role: 'SUPERUSER' }],
    ['a non-string company', { sub: 'u', companyId: 42, role: UserRole.ADMIN }],
    ['empty claims', {}],
  ])('refuses a correctly signed token with %s, so `undefined` never reaches a query as a company id', (_label, claims) => {
    expect(() => strategy.validate(claims as never)).toThrow(UnauthorizedException);
  });
});
