import { UserRole } from '../../onboarding/domain/user.entity';

/**
 * Who is making the request, as far as the rest of the app is concerned. Controllers receive this (via
 * @CurrentUser()) and use `companyId` to scope every query: the caller never says WHICH company, the token does.
 */
export interface AuthenticatedUser {
  userId: string;
  companyId: string;
  role: UserRole;
}
