import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { TokenBlacklistService } from '../token-blacklist.service';
import { JwtKeyService } from '../jwt-key.service';

export interface JwtPayload {
  sub: string; // Wallet address
  walletAddress: string;
  jti?: string; // JWT ID for revocation
  kid?: string; // Key ID for rotation
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly blacklist: TokenBlacklistService,
    private readonly jwtKeyService: JwtKeyService,
  ) {
    const keyService = jwtKeyService;

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      /**
       * secretOrKeyProvider allows rotating secrets: the provider receives the
       * raw JWT header and selects the matching secret by `kid`.  When the `kid`
       * is unknown (neither current nor previous) the token is rejected.
       */
      secretOrKeyProvider: (
        _req: unknown,
        rawJwtToken: string,
        done: (err: Error | null, secret?: string) => void,
      ) => {
        try {
          // Decode header without verifying signature to extract kid.
          const [headerB64] = rawJwtToken.split('.');
          const header = JSON.parse(
            Buffer.from(headerB64, 'base64url').toString('utf8'),
          ) as { kid?: string };

          const kid = header.kid ?? keyService.signingKey.kid;
          const secret = keyService.secretForKid(kid);

          if (!secret) {
            done(new UnauthorizedException('Unknown key id'));
            return;
          }

          done(null, secret);
        } catch {
          done(new UnauthorizedException('Malformed token header'));
        }
      },
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
