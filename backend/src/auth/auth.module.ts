import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfig } from '../config/configuration';
import { AuthTokenService, JWT_ALGORITHM } from './auth-token.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';

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
  providers: [JwtStrategy, JwtAuthGuard, AuthTokenService],
  exports: [JwtAuthGuard, AuthTokenService],
})
export class AuthModule {}
