import { UserRole } from '../../onboarding/domain/user.entity';


export const JWT_ALGORITHM = 'HS256';
export const JWT_ISSUER = 'payment-service';

export interface JwtClaims {
  sub: string;
  companyId: string;
  role: UserRole;
}
