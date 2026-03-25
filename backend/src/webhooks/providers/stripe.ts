/**
 * Stripe webhook verification.
 *
 * Scheme: Stripe-Signature header
 *   Format: t=<unix_timestamp>,v1=<hmac_sha256_hex>[,v1=<hex>...]
 *   Signed payload: "<timestamp>.<raw_body>"
 *   Idempotency key: payload.id (Stripe event ID, e.g. "evt_...")
 *   Event type: payload.type
 *
 * Timestamp validation: reject if |now - t| > toleranceSeconds.
 * Constant-time comparison used for all signature checks.
 * Multiple v1 signatures supported (Stripe sends both during rotation).
 */

import { createHmac, timingSafeEqual } from "crypto";
import { IncomingHttpHeaders } from "http";
import { ProviderConfig, VerifyResult } from "../../types/webhook";

interface StripeSigParts {
  timestamp: number;
  v1Sigs: string[];
}

function parseStripeSig(header: string): StripeSigParts | null {
  const parts = header.split(",");
  let timestamp: number | null = null;
  const v1Sigs: string[] = [];

  for (const part of parts) {
    const [key, val] = part.split("=", 2);
    if (key === "t") timestamp = parseInt(val, 10);
    if (key === "v1" && val) v1Sigs.push(val);
  }

  if (timestamp === null || isNaN(timestamp) || v1Sigs.length === 0) return null;
  return { timestamp, v1Sigs };
}

export function verifyStripe(
  rawBody: Buffer,
  headers: IncomingHttpHeaders,
  config: ProviderConfig,
  nowSeconds = Math.floor(Date.now() / 1000)
): VerifyResult {
  const sigHeader = headers["stripe-signature"];
  if (!sigHeader || typeof sigHeader !== "string") {
    return { ok: false, reason: "missing_header" };
  }

  const parsed = parseStripeSig(sigHeader);
  if (!parsed) return { ok: false, reason: "missing_header" };

  const tolerance = config.toleranceSeconds ?? 300;
  if (Math.abs(nowSeconds - parsed.timestamp) > tolerance) {
    return { ok: false, reason: "replay" };
  }

  const signedPayload = `${parsed.timestamp}.${rawBody.toString("utf8")}`;

  for (const secret of config.secrets) {
    const expected = createHmac("sha256", secret)
      .update(signedPayload, "utf8")
      .digest("hex");

    const expectedBuf = Buffer.from(expected, "utf8");

    for (const v1 of parsed.v1Sigs) {
      const providedBuf = Buffer.from(v1, "utf8");
      if (
        expectedBuf.length === providedBuf.length &&
        timingSafeEqual(expectedBuf, providedBuf)
      ) {
        return { ok: true };
      }
    }
  }

  return { ok: false, reason: "invalid_signature" };
}

export function extractStripeMeta(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>
): { idempotencyKey: string | null; eventType: string } {
  return {
    idempotencyKey: typeof body.id === "string" ? body.id : null,
    eventType: typeof body.type === "string" ? body.type : "unknown",
  };
}
