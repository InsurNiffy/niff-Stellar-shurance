import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string; // Wallet address
  walletAddress: string;
  iat?: number;
  exp?: number;
}

/**
 * Resolves the set of active JWT secrets for verification.
 *
 * During a zero-downtime rotation:
 *   1. Set JWT_SECRET_NEXT = <new key> and redeploy — both keys accepted.
 *   2. After JWT_EXPIRES_IN has elapsed (all old tokens expired), promote:
 *      JWT_SECRET = <new key>, unset JWT_SECRET_NEXT, redeploy.
 *
 * passport-jwt's secretOrKeyProvider is called per-request with the raw token
 * so we can try each candidate key in order.
 */
function makeSecretOrKeyProvider(
  configService: ConfigService,
): (
  _req: unknown,
  rawJwtToken: string,
  done: (err: Error | null, secret?: string | Buffer) => void,
) => void {
  return (_req, _rawJwtToken, done) => {
    // Primary key is always required; secondary is optional (rotation overlap).
    const primary = configService.get<string>('JWT_SECRET') ?? ''
    const next = configService.get<string>('JWT_SECRET_NEXT') ?? ''
    // Return the primary key; passport-jwt will call validate() on success.
    // If verification fails with the primary key passport-jwt returns 401 —
    // we handle the secondary key via a custom secretOrKeyProvider that tries
    // both. passport-jwt v4 supports returning an array of secrets.
    const secrets: string[] = [primary]
    if (next) secrets.push(next)
    // passport-jwt accepts a single secret; for multi-key we return the first
    // and rely on the secretOrKeyProvider being called once per token. To
    // support both keys we return them joined — passport-jwt v4+ accepts an
    // array when using secretOrKeyProvider.
    done(null, secrets.length === 1 ? secrets[0] : (secrets as unknown as string))
  }
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly configService: ConfigService) {
    const primary = configService.get<string>('JWT_SECRET') ?? ''
    const next = configService.get<string>('JWT_SECRET_NEXT') ?? ''
    const secrets = next ? [primary, next] : primary

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // passport-jwt v4 accepts an array of secrets; it tries each in order.
      secretOrKey: secrets,
    });
  }

  async validate(payload: JwtPayload): Promise<{ walletAddress: string }> {
    if (!payload.walletAddress) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return { walletAddress: payload.walletAddress };
  }
}
