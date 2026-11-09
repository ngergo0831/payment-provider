import { UserRole } from '../../onboarding/domain/user.entity';

/**
 * Signing and verification must agree on these, so they live in one file.
 *
 * ALGORITHM is pinned on BOTH sides. If verification accepted whatever the token's header claims, an attacker
 * could send `alg: none` (no signature at all) or switch to a different algorithm, the classic JWT bypass.
 */
export const JWT_ALGORITHM = 'HS256';

export const JWT_ISSUER = 'payment-service';

export interface JwtClaims {
  sub: string;
  companyId: string;
  role: UserRole;
}
