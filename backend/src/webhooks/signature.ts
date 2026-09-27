/**
 * Outbound webhook HMAC signing + verification (#1484).
 *
 * Header format (Stripe-style, documented in docs/webhooks.md):
 *
 *     X-Niffy-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>
 *
 * Signed content: `${t}.${rawBody}` — the timestamp is part of the signed
 * payload, so a captured signature cannot be replayed with a fresh timestamp.
 *
 * Replay protection: verifiers MUST reject timestamps outside a 5-minute
 * (300 s) tolerance window.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'X-Niffy-Signature';
export const TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 minutes

export interface SignatureParts {
  /** Unix timestamp (seconds) the signature was produced for. */
  timestamp: number;
  /** Hex-encoded HMAC-SHA256 values (supports multiple secrets for rotation). */
  signatures: string[];
}

function hmacHex(secret: string, content: string): string {
  return createHmac('sha256', secret).update(content, 'utf8').digest('hex');
}

/** Raw hex HMAC-SHA256 of `content` with `secret`. */
export function computeHmac(secret: string, content: string): string {
  return hmacHex(secret, content);
}

/**
 * Builds the `X-Niffy-Signature` header value for a payload.
 * The JSON body is serialized deterministically (stable key order) so the
 * signature can be recomputed by the receiver from the received raw bytes.
 */
export function signPayload(
  secret: string,
  payload: Record<string, unknown>,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const rawBody = JSON.stringify(payload);
  return signRawBody(secret, rawBody, timestampSeconds);
}

/** Signs an already-serialized JSON body. */
export function signRawBody(
  secret: string,
  rawBody: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const t = Math.floor(timestampSeconds);
  const v1 = hmacHex(secret, `${t}.${rawBody}`);
  return `t=${t},v1=${v1}`;
}

/** Parses `t=<ts>,v1=<hex>[,v1=<hex>]` into its parts. Null when malformed. */
export function parseSignatureHeader(header: string): SignatureParts | null {
  if (typeof header !== 'string' || header.trim() === '') return null;

  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) return null;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return null;
      timestamp = Math.floor(parsed);
    } else if (key === 'v1') {
      if (!/^[0-9a-f]{64}$/i.test(value)) return null;
      signatures.push(value.toLowerCase());
    }
  }

  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export interface VerifyOptions {
  /** Replay window in seconds (default 300 — 5 minutes). */
  toleranceSeconds?: number;
  /** Injectable clock for tests. */
  nowSeconds?: number;
}

export type VerifyResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'mismatch' };

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verifies an outbound signature header against the raw request body.
 * Rejects: missing/malformed headers, timestamps outside the tolerance
 * (replay protection) and HMAC mismatches (tampered payloads).
 */
export function verifySignature(
  header: string | undefined | null,
  rawBody: string,
  secrets: string | string[],
  options: VerifyOptions = {},
): VerifyResult {
  const tolerance = options.toleranceSeconds ?? TIMESTAMP_TOLERANCE_SECONDS;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!header) return { ok: false, reason: 'missing' };

  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: 'malformed' };

  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { ok: false, reason: 'stale' };
  }

  const secretList = Array.isArray(secrets) ? secrets : [secrets];
  if (secretList.length === 0) return { ok: false, reason: 'mismatch' };

  const expected = `${parsed.timestamp}.${rawBody}`;
  const matches = parsed.signatures.some((candidate) =>
    secretList.some((secret) => safeEqualHex(candidate, hmacHex(secret, expected))),
  );

  return matches ? { ok: true, timestamp: parsed.timestamp } : { ok: false, reason: 'mismatch' };
}
