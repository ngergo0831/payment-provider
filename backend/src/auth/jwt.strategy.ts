import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfig } from '../config/configuration';
import { JWT_ALGORITHM, JWT_ISSUER } from './auth-token.service';
import { AuthenticatedUser } from './current-user.decorator';

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

  validate(claims: { sub?: unknown; companyId?: unknown }): AuthenticatedUser {
    if (typeof claims.sub !== 'string' || typeof claims.companyId !== 'string') throw new UnauthorizedException();
    return { userId: claims.sub, companyId: claims.companyId };
  }
}
