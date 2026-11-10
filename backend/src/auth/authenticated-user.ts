/** The caller, from the token. `companyId` scopes every query: the caller never says WHICH company, the token does. */
export interface AuthenticatedUser {
  userId: string;
  companyId: string;
}
