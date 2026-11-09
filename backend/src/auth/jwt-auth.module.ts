import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfig } from '../config/configuration';
import { TokenIssuer } from './application/token-issuer';
import { JwtTokenIssuer } from './infrastructure/jwt-token-issuer';
import { JWT_ALGORITHM } from './infrastructure/jwt.constants';
import { JwtStrategy } from './infrastructure/jwt.strategy';
import { JwtAuthGuard } from './presentation/jwt-auth.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const { secret, expiresIn } = config.get('jwt', { infer: true });
        // `as never`: the library types expiresIn as a branded string; our env validation already guarantees the format.
        return { secret, signOptions: { algorithm: JWT_ALGORITHM, expiresIn: expiresIn as never } };
      },
    }),
  ],
  providers: [JwtStrategy, JwtAuthGuard, { provide: TokenIssuer, useClass: JwtTokenIssuer }],
  exports: [JwtAuthGuard, TokenIssuer],
})
export class JwtAuthModule {}
