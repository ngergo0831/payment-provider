import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Put `@UseGuards(JwtAuthGuard)` on a controller or route to require a valid bearer token.
 * A missing, malformed, expired or forged token all end the same way: 401 in the standard error shape.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
