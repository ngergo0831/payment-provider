import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The caller, from the token. `companyId` scopes every query: the caller never says WHICH company, the token does. */
export interface AuthenticatedUser {
  userId: string;
  companyId: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => context.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user,
);
