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
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { v4 as uuidv4 } from 'uuid';
import { NonceService } from './nonce.service';

@Injectable()
export class WalletAuthService {
  private readonly logger = new Logger(WalletAuthService.name);

  constructor(
    private readonly nonceService: NonceService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
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
    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      throw new BadRequestException({
        code: 'INVALID_PUBLIC_KEY',
        message: 'Invalid Stellar public key.',
      });
    }

    const nonce = uuidv4();
    const ttl = this.configService.get<number>('NONCE_TTL_SECONDS', 300);
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    const message = this.buildMessage(publicKey, nonce, issuedAt, expiresAt);

    await this.nonceService.store(nonce, { publicKey, message });

    return { nonce, message, expiresAt };
  }

  async verifyChallenge(
    publicKey: string,
    nonce: string,
    signatureBase64: string,
  ): Promise<{ token: string; expiresAt: string }> {
    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
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

    if (stored.publicKey !== publicKey) {
      throw new UnauthorizedException({
        code: 'KEY_MISMATCH',
        message: 'Public key does not match the one used to request the challenge.',
      });
    }

    try {
      const keypair = Keypair.fromPublicKey(publicKey);
      const valid = keypair.verify(
        Buffer.from(stored.message),
        Buffer.from(signatureBase64, 'base64'),
      );
      if (!valid) {
        throw new UnauthorizedException({
          code: 'INVALID_SIGNATURE',
          message: 'Signature verification failed. Sign the exact message string.',
        });
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException({
        code: 'INVALID_SIGNATURE',
        message: 'Signature verification failed.',
      });
    }

    const ttlSeconds = this.parseTtl(
      this.configService.get<string>('JWT_TTL', '1h'),
    );
    const now = Math.floor(Date.now() / 1000);
    // scope='user' — explicitly not admin
    const payload = { sub: publicKey, scope: 'user', iat: now, exp: now + ttlSeconds };
    const token = this.jwtService.sign(payload);
    const expiresAt = new Date((now + ttlSeconds) * 1000).toISOString();

    return { token, expiresAt };
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
