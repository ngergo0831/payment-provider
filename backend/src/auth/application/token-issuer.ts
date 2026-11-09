import { AuthenticatedUser } from '../domain/authenticated-user';

export interface IssuedToken {
  accessToken: string;
  tokenType: 'Bearer';
}

/** PORT: "give this user a credential". The JWT details live in the adapter, not here. */
export abstract class TokenIssuer {
  abstract issue(user: AuthenticatedUser): Promise<IssuedToken>;
}
