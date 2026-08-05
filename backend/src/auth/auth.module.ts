import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategy';
import { WalletAuthService } from './wallet-auth.service';
import { NonceService } from './nonce.service';
import { RefreshTokenService } from './refresh-token.service';
import { AuthController } from './auth.controller';
import { AuthIdentityService } from './auth-identity.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { WalletSignatureService } from './wallet-signature.service';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [
    CacheModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [JwtStrategy, WalletAuthService, NonceService, RefreshTokenService, AuthIdentityService, TokenBlacklistService, WalletSignatureService],
  exports: [PassportModule, JwtModule, AuthIdentityService, TokenBlacklistService],
})
export class AuthModule {}
