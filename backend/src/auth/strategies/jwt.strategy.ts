import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { TokenBlacklistService } from '../token-blacklist.service';

export interface JwtPayload {
  sub: string; // Wallet address
  walletAddress: string;
  jti?: string; // JWT ID for revocation
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly blacklist: TokenBlacklistService,
  ) {
    const primary = configService.get<string>('JWT_SECRET') ?? ''

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: primary,
    });
  }

  async validate(payload: JwtPayload): Promise<{ walletAddress: string }> {
    if (!payload.walletAddress) {
      throw new UnauthorizedException('Invalid token payload');
    }

    if (payload.jti) {
      const isBlacklisted = await this.blacklist.isBlacklisted(payload.jti);
      if (isBlacklisted) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    return { walletAddress: payload.walletAddress };
  }
}
