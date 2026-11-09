import { AuthenticatedUser } from '../domain/authenticated-user';

export interface IssuedToken {
  accessToken: string;
  tokenType: 'Bearer';
}

export abstract class TokenIssuer {
  abstract issue(user: AuthenticatedUser): Promise<IssuedToken>;
}
