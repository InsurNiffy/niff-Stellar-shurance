/**
 * WalletAuthService — SIWE-style challenge/verify for Stellar wallets.
 *
 * SECURITY:
 *   - Nonces are single-use (deleted before JWT is issued — prevents replay).
 *   - Nonces expire after NONCE_TTL_SECONDS (default 5 min).
 *   - JWTs carry scope='user' only — no admin capabilities.
 *   - This auth layer is for API personalisation and rate-limiting only.
 *     On-chain fund movements always require the wallet to sign the Soroban
 *     transaction independently.
 *   - Private keys are never requested, accepted, or logged.
 */
import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { StrKey } from '@stellar/stellar-sdk';
import { v4 as uuidv4 } from 'uuid';
import { NonceService } from './nonce.service';
import { WalletSignatureService } from './wallet-signature.service';
import { normalizeAddress } from '../common/utils/normalize-address';
import { RefreshTokenService } from './refresh-token.service';

@Injectable()
export class WalletAuthService {
  private readonly logger = new Logger(WalletAuthService.name);

  constructor(
    private readonly nonceService: NonceService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly walletSignatureService: WalletSignatureService,
  ) {}

  private get domain(): string {
    return this.configService.get<string>('AUTH_DOMAIN', 'niffyinsure.local');
  }

  private buildMessage(
    publicKey: string,
    nonce: string,
    issuedAt: string,
    expiresAt: string,
  ): string {
    return [
      `${this.domain} wants you to sign in with your Stellar account:`,
      publicKey,
      '',
      'Please sign this challenge to verify your identity.',
      '',
      `URI: https://${this.domain}`,
      'Version: 1',
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`,
      `Expiration Time: ${expiresAt}`,
    ].join('\n');
  }

  async generateChallenge(
    publicKey: string,
  ): Promise<{ nonce: string; message: string; expiresAt: string }> {
    // Normalize and validate at the API boundary
    const canonicalKey = normalizeAddress(publicKey);
    if (!StrKey.isValidEd25519PublicKey(canonicalKey)) {
      throw new BadRequestException({
        code: 'INVALID_PUBLIC_KEY',
        message: 'Invalid Stellar public key.',
      });
    }

    const nonce = uuidv4();
    const ttl = this.configService.get<number>('NONCE_TTL_SECONDS', 300);
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    const message = this.buildMessage(canonicalKey, nonce, issuedAt, expiresAt);

    await this.nonceService.store(nonce, { publicKey: canonicalKey, message });

    return { nonce, message, expiresAt };
  }

  async verifyChallenge(
    publicKey: string,
    nonce: string,
    signatureBase64: string,
  ): Promise<{ token: string; expiresAt: string; refreshToken: string }> {
    const canonicalKey = normalizeAddress(publicKey);
    if (!StrKey.isValidEd25519PublicKey(canonicalKey)) {
      throw new BadRequestException({
        code: 'INVALID_PUBLIC_KEY',
        message: 'Invalid Stellar public key.',
      });
    }

    // consume() deletes nonce atomically — prevents replay on any path
    const stored = await this.nonceService.consume(nonce);
    if (!stored) {
      throw new UnauthorizedException({
        code: 'NONCE_EXPIRED_OR_USED',
        message: 'Challenge expired or already used. Request a new challenge.',
      });
    }

    if (stored.publicKey !== canonicalKey) {
      throw new UnauthorizedException({
        code: 'KEY_MISMATCH',
        message: 'Public key does not match the one used to request the challenge.',
      });
    }

    try {
      await this.walletSignatureService.verifyEd25519(
        canonicalKey,
        stored.message,
        signatureBase64,
      );
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_SIGNATURE',
        message: 'Signature verification failed.',
      });
    }

    // Access token: 15 minutes (hard-coded; not configurable to prevent accidental extension)
    const ACCESS_TTL = 15 * 60;
    const now = Math.floor(Date.now() / 1000);
    // scope='user' — explicitly not admin; exp set via signOptions only
    const payload = { sub: canonicalKey, walletAddress: canonicalKey, scope: 'user', iat: now };
    const token = this.jwtService.sign(payload, { expiresIn: ACCESS_TTL });
    const expiresAt = new Date((now + ACCESS_TTL) * 1000).toISOString();

    const refreshToken = await this.refreshTokenService.issue(canonicalKey);

    return { token, expiresAt, refreshToken };
  }

  /** Exchange a valid refresh token for a new access + refresh token pair. */
  async refresh(rawRefreshToken: string): Promise<{ token: string; expiresAt: string; refreshToken: string }> {
    const walletAddress = await this.refreshTokenService.consume(rawRefreshToken);

    const ACCESS_TTL = 15 * 60;
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: walletAddress, walletAddress, scope: 'user', iat: now };
    const token = this.jwtService.sign(payload, { expiresIn: ACCESS_TTL });
    const expiresAt = new Date((now + ACCESS_TTL) * 1000).toISOString();

    const newRefreshToken = await this.refreshTokenService.issue(walletAddress);

    return { token, expiresAt, refreshToken: newRefreshToken };
  }

  /** Invalidate a refresh token immediately (logout). */
  async logout(rawRefreshToken: string): Promise<void> {
    await this.refreshTokenService.revoke(rawRefreshToken);
  }

  private parseTtl(ttl: string): number {
    const m = /^(\d+)([smhd])$/.exec(ttl);
    if (!m) return 3600;
    const n = parseInt(m[1], 10);
    if (m[2] === 's') return n;
    if (m[2] === 'm') return n * 60;
    if (m[2] === 'h') return n * 3600;
    if (m[2] === 'd') return n * 86400;
    return 3600;
  }
}
