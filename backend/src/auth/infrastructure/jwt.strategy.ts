import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfig } from '../../config/configuration';
import { UserRole } from '../../onboarding/domain/user.entity';
import { AuthenticatedUser } from '../domain/authenticated-user';
import { JWT_ALGORITHM, JWT_ISSUER, JwtClaims } from './jwt.constants';

/**
 * Verifies the bearer token on incoming requests. passport-jwt has ALREADY checked signature, algorithm,
 * issuer and expiry by the time `validate` runs; this method only turns the claims into our own type.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('jwt', { infer: true }).secret,
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      ignoreExpiration: false,
    });
  }

  validate(claims: Partial<JwtClaims>): AuthenticatedUser {
    // A correctly signed token that lacks our claims (e.g. from an older version) is not usable. Refuse it
    // rather than let `undefined` flow into queries as a company id.
    const isUsable =
      typeof claims.sub === 'string' &&
      typeof claims.companyId === 'string' &&
      Object.values(UserRole).includes(claims.role as UserRole);
    if (!isUsable) throw new UnauthorizedException();

    return { userId: claims.sub as string, companyId: claims.companyId as string, role: claims.role as UserRole };
  }
}
