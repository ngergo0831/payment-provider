import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthenticatedUser } from './current-user.decorator';

export const JWT_ALGORITHM = 'HS256';
export const JWT_ISSUER = 'payment-service';

@Injectable()
export class AuthTokenService {
  constructor(private readonly jwt: JwtService) {}

  issue(user: AuthenticatedUser): Promise<string> {
    return this.jwt.signAsync({ companyId: user.companyId }, { subject: user.userId, issuer: JWT_ISSUER, algorithm: JWT_ALGORITHM });
  }
}
