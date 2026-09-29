/**
 * JwtKeyService — rotate JWT signing secrets without invalidating in-flight tokens.
 *
 * During rotation, two secrets are active simultaneously:
 *   - The NEW secret (kid = JWT_KEY_ID, typically "v2", "v3", …)  — used for signing.
 *   - The OLD secret (kid = JWT_KEY_ID_PREV)                      — accepted for verification only.
 *
 * Tokens signed with the old secret keep working until they expire naturally
 * (access tokens: 15 min, refresh tokens: 7 d).  Once the window has passed,
 * remove JWT_KEY_ID_PREV from the environment to stop accepting the old secret.
 *
 * Environment variables
 * ─────────────────────
 *   JWT_SECRET       — current (new) signing secret (required)
 *   JWT_KEY_ID       — kid header for the current secret (default: "v1")
 *   JWT_SECRET_PREV  — previous signing secret (optional; accepted for verification)
 *   JWT_KEY_ID_PREV  — kid for the previous secret (default: "v0")
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface JwtKey {
  kid: string;
  secret: string;
}

@Injectable()
export class JwtKeyService {
  private readonly currentKey: JwtKey;
  private readonly previousKey: JwtKey | null;

  constructor(private readonly config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET') ?? '';
    const kid = config.get<string>('JWT_KEY_ID', 'v1');

    this.currentKey = { kid, secret };

    const prevSecret = config.get<string>('JWT_SECRET_PREV');
    const prevKid = config.get<string>('JWT_KEY_ID_PREV', 'v0');
    this.previousKey = prevSecret ? { kid: prevKid, secret: prevSecret } : null;
  }

  /** The active key used to SIGN new tokens. */
  get signingKey(): JwtKey {
    return this.currentKey;
  }

  /**
   * Resolve the secret for a given `kid` header value.
   *
   * Returns the secret string when `kid` matches the current or previous key,
   * or `null` when the `kid` is unknown (token must be rejected).
   */
  secretForKid(kid: string): string | null {
    if (kid === this.currentKey.kid) return this.currentKey.secret;
    if (this.previousKey && kid === this.previousKey.kid) return this.previousKey.secret;
    return null;
  }

  /**
   * All currently accepted secrets, for use with passport-jwt `secretOrKeyProvider`.
   *
   * Returns the current secret first, then the previous (if set).
   */
  acceptedSecrets(): string[] {
    const secrets = [this.currentKey.secret];
    if (this.previousKey) secrets.push(this.previousKey.secret);
    return secrets;
  }
}
