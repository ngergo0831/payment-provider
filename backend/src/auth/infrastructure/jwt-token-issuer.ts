import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IssuedToken, TokenIssuer } from '../application/token-issuer';
import { AuthenticatedUser } from '../domain/authenticated-user';
import { JWT_ALGORITHM, JWT_ISSUER } from './jwt.constants';

@Injectable()
export class JwtTokenIssuer extends TokenIssuer {
  constructor(private readonly jwt: JwtService) {
    super();
  }

  async issue(user: AuthenticatedUser): Promise<IssuedToken> {
    const accessToken = await this.jwt.signAsync(
      { companyId: user.companyId, role: user.role },
      { subject: user.userId, issuer: JWT_ISSUER, algorithm: JWT_ALGORITHM },
    );
    return { accessToken, tokenType: 'Bearer' };
  }
}
