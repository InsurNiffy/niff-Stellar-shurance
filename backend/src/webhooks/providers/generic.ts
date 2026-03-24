/**
 * Generic webhook verification.
 *
 * Scheme: HMAC-SHA256 with timestamp header
 *   Signature header: X-Webhook-Signature: sha256=<hex>
 *   Timestamp header: X-Webhook-Timestamp: <unix_seconds>
 *   Idempotency key:  X-Webhook-Id
 *   Event type:       X-Webhook-Event
 *
 * Signed payload: "<timestamp>.<raw_body>"
 * Timestamp validation: reject if |now - t| > toleranceSeconds.
 * Constant-time comparison used.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { IncomingHttpHeaders } from "http";
import { ProviderConfig, VerifyResult } from "../../types/webhook";

export function verifyGeneric(
  rawBody: Buffer,
  headers: IncomingHttpHeaders,
  config: ProviderConfig,
  nowSeconds = Math.floor(Date.now() / 1000)
): VerifyResult {
  const sigHeader = headers["x-webhook-signature"];
  const tsHeader = headers["x-webhook-timestamp"];

  if (!sigHeader || typeof sigHeader !== "string") {
    return { ok: false, reason: "missing_header" };
  }
  if (!tsHeader || typeof tsHeader !== "string") {
    return { ok: false, reason: "missing_header" };
  }

  const timestamp = parseInt(tsHeader, 10);
  if (isNaN(timestamp)) return { ok: false, reason: "missing_header" };

  const tolerance = config.toleranceSeconds ?? 300;
  if (Math.abs(nowSeconds - timestamp) > tolerance) {
    return { ok: false, reason: "replay" };
  }

  const provided = sigHeader.startsWith("sha256=")
    ? sigHeader.slice(7)
    : sigHeader;

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;

  for (const secret of config.secrets) {
    const expected = createHmac("sha256", secret)
      .update(signedPayload, "utf8")
      .digest("hex");

    const expectedBuf = Buffer.from(expected, "utf8");
    const providedBuf = Buffer.from(provided, "utf8");

    if (
      expectedBuf.length === providedBuf.length &&
      timingSafeEqual(expectedBuf, providedBuf)
    ) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "invalid_signature" };
}

export function extractGenericMeta(headers: IncomingHttpHeaders): {
  idempotencyKey: string | null;
  eventType: string;
} {
  return {
    idempotencyKey:
      typeof headers["x-webhook-id"] === "string"
        ? headers["x-webhook-id"]
        : null,
    eventType:
      typeof headers["x-webhook-event"] === "string"
        ? headers["x-webhook-event"]
        : "unknown",
  };
}
