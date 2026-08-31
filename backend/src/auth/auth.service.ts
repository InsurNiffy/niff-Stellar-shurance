/**
 * Wallet challenge authentication service.
 *
 * Implements a SIWE-style (Sign-In With Ethereum, adapted for Stellar) flow:
 *   1. Client requests a challenge nonce.
 *   2. Client signs the canonical challenge message with their Stellar private key.
 *   3. Server verifies the Ed25519 signature and issues a short-lived JWT.
 *
 * SECURITY NOTES:
 *   - Nonces are single-use (deleted before JWT is minted to prevent replay).
 *   - Nonces expire after NONCE_TTL_SECONDS (default 5 min).
 *   - JWTs carry scope='user' only — they do NOT grant admin capabilities.
 *   - This auth layer is for API personalization, rate-limiting, and "my data"
 *     views.  On-chain fund movements always require the wallet to sign the
 *     Soroban transaction independently.
 *   - Private keys are never requested, accepted, or logged.
 */

import { StrKey } from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { config } from '../config/env';
import { getNonceStore } from './nonce.store';
import { WalletSignatureService } from './wallet-signature.service';

// ── Challenge message ─────────────────────────────────────────────────────────

interface StoredChallenge {
  publicKey: string;
  message: string;
  issuedAt: string;
}

/**
 * Builds the canonical challenge message that the client must sign.
 * Format is inspired by EIP-4361 (SIWE) adapted for Stellar.
 */
function buildChallengeMessage(
  publicKey: string,
  nonce: string,
  issuedAt: string,
  expiresAt: string,
): string {
  return [
    `${config.auth.domain} wants you to sign in with your Stellar account:`,
    publicKey,
    '',
    'Please sign this challenge to verify your identity.',
    '',
    `URI: https://${config.auth.domain}`,
    `Version: 1`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expiresAt}`,
  ].join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ChallengeResponse {
  nonce: string;
  /** Exact string the client must sign with their Stellar private key. */
  message: string;
  expiresAt: string;
}

export interface VerifyResponse {
  /** Signed JWT — sub=publicKey, scope=user. */
  token: string;
  /** ISO timestamp when the token expires. */
  expiresAt: string;
}

export async function generateChallenge(
  publicKey: string,
): Promise<ChallengeResponse> {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new BadRequestException('Invalid Stellar public key.');
  }

  const nonce = uuidv4();
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + config.auth.nonceTtlSeconds * 1000,
  ).toISOString();

  const message = buildChallengeMessage(publicKey, nonce, issuedAt, expiresAt);

  const stored: StoredChallenge = { publicKey, message, issuedAt };
  const store = await getNonceStore();
  await store.set(nonce, JSON.stringify(stored), config.auth.nonceTtlSeconds);

  return { nonce, message, expiresAt };
}

export async function verifyChallenge(
  publicKey: string,
  nonce: string,
  signatureBase64: string,
): Promise<VerifyResponse> {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new BadRequestException('Invalid Stellar public key.');
  }

  const store = await getNonceStore();
  const raw = await store.get(nonce);

  if (!raw) {
    throw new UnauthorizedException(
      'Challenge expired or already used. Request a new challenge.',
    );
  }

  const stored = JSON.parse(raw) as StoredChallenge;

  if (stored.publicKey !== publicKey) {
    // Delete nonce to invalidate any further attempts with this nonce
    await store.del(nonce);
    throw new UnauthorizedException(
      'The public key does not match the one used to request the challenge.',
    );
  }

  // Delete nonce BEFORE verifying — ensures single-use even if verification
  // throws, preventing an attacker from probing with the same nonce.
  await store.del(nonce);

  const signatureService = new WalletSignatureService();
  try {
    await signatureService.verifyEd25519(publicKey, stored.message, signatureBase64);
  } catch (err) {
    if (err instanceof UnauthorizedException) throw err;
    throw new UnauthorizedException('Signature verification failed.');
  }

  // Mint JWT — scope is explicitly 'user'; no admin capabilities are granted.
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = parseTtlToSeconds(config.jwt.ttl);
  const payload = {
    sub: publicKey,
    scope: 'user',
    iss: config.jwt.issuer,
    iat: now,
    exp: now + ttlSeconds,
  };

  const token = jwt.sign(payload, config.jwt.secret);
  const expiresAt = new Date((now + ttlSeconds) * 1000).toISOString();

  return { token, expiresAt };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseTtlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 3600;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 's') return n;
  if (unit === 'm') return n * 60;
  if (unit === 'h') return n * 3600;
  if (unit === 'd') return n * 86400;
  return 3600;
}
