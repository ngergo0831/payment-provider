import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const config = { get: () => ({ secret: 'unit-test-secret-that-is-at-least-32-chars', expiresIn: '1h' }) } as unknown as ConfigService<
    AppConfig,
    true
  >;
  const strategy = new JwtStrategy(config);

  it.each([
    ['no company', { sub: 'u' }],
    ['no subject', { companyId: 'c' }],
    ['a non-string company', { sub: 'u', companyId: 42 }],
    ['empty claims', {}],
  ])('refuses a correctly signed token with %s, so `undefined` never reaches a query as a company id', (_label, claims) => {
    expect(() => strategy.validate(claims)).toThrow(UnauthorizedException);
  });
});
