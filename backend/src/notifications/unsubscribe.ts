/**
 * Signed one-click unsubscribe links — RFC 8058 (#1483).
 *
 * Token format: `<base64url(payloadJson)>.<base64url(hmacSha256)>`
 * The HMAC covers the encoded payload, so tokens cannot be forged or edited.
 *
 * RFC 8058 requires:
 *   - `List-Unsubscribe: <https://…/notifications/unsubscribe?token=…>`
 *   - `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * and that a POST to the URL (with no user interaction) unsubscribes.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const ONE_CLICK_HEADER_VALUE = 'List-Unsubscribe=One-Click';

export interface UnsubscribePayload {
  userId: string;
  channel: 'email';
  /** Optional scope: event type the token opts out of, or '*' for all. */
  scope?: string;
  /** Expiry (unix seconds) — defaults to 30 days from issue time. */
  exp: number;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function hmacHex(secret: string, content: string): string {
  return createHmac('sha256', secret).update(content, 'utf8').digest('hex');
}

/** Signs an unsubscribe payload into a tamper-proof token. */
export function signUnsubscribeToken(
  payload: {
    userId: string;
    channel?: 'email';
    scope?: string;
    exp?: number;
  },
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const body: UnsubscribePayload = {
    ...payload,
    channel: 'email',
    exp: payload.exp ?? nowSeconds + 60 * 60 * 24 * 30, // 30 days
  };
  const encoded = b64url(JSON.stringify(body));
  const signature = hmacHex(secret, `${encoded}`);
  return `${encoded}.${b64url(Buffer.from(signature, 'hex'))}`;
}

/**
 * Verifies a token: signature must match and `exp` must be in the future.
 * Returns null for forged, malformed or expired tokens.
 */
export function verifyUnsubscribeToken(
  token: string | undefined | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): UnsubscribePayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;

  const [encoded, signaturePart] = token.split('.');
  if (!encoded || !signaturePart) return null;

  const expected = Buffer.from(hmacHex(secret, encoded), 'hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(signaturePart, 'base64url');
  } catch {
    return null;
  }
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  let payload: UnsubscribePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.userId !== 'string' || typeof payload.exp !== 'number') {
    return null;
  }
  if (payload.exp <= nowSeconds) return null;
  return { ...payload, channel: 'email' };
}

/** RFC 8058 headers attached to every notification email. */
export function buildUnsubscribeHeaders(listUnsubscribeUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${listUnsubscribeUrl}>`,
    'List-Unsubscribe-Post': ONE_CLICK_HEADER_VALUE,
  };
}

/** Builds the absolute unsubscribe URL for a token. */
export function buildUnsubscribeUrl(token: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/v1/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** Resolves the HMAC secret used to sign/verify unsubscribe tokens. */
export function resolveUnsubscribeSecret(config: {
  get(key: string, defaultValue?: string): unknown;
}): string {
  return (
    (config.get('UNSUBSCRIBE_SECRET') as string | undefined) ||
    (config.get('JWT_SECRET') as string | undefined) ||
    'niffyinsure-unsubscribe-dev'
  );
}
