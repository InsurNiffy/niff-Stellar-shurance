/**
 * GitHub webhook verification.
 *
 * Scheme: HMAC-SHA256
 *   Header: X-Hub-Signature-256: sha256=<hex>
 *   Idempotency key: X-GitHub-Delivery (UUID per delivery)
 *   Event type: X-GitHub-Event
 *
 * Timestamp validation: GitHub does not send a timestamp header, so replay
 * protection is based solely on idempotency key deduplication. The tolerance
 * window is therefore not applied for GitHub.
 *
 * Constant-time comparison is used to prevent timing attacks.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { IncomingHttpHeaders } from "http";
import { ProviderConfig, VerifyResult } from "../../types/webhook";

export function verifyGitHub(
  rawBody: Buffer,
  headers: IncomingHttpHeaders,
  config: ProviderConfig
): VerifyResult {
  const sigHeader = headers["x-hub-signature-256"];
  if (!sigHeader || typeof sigHeader !== "string") {
    return { ok: false, reason: "missing_header" };
  }

  const provided = sigHeader.startsWith("sha256=")
    ? sigHeader.slice(7)
    : sigHeader;

  // Try each active secret — supports rotation
  for (const secret of config.secrets) {
    const expected = createHmac("sha256", secret)
      .update(rawBody)
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

export function extractGitHubMeta(headers: IncomingHttpHeaders): {
  idempotencyKey: string | null;
  eventType: string;
} {
  return {
    idempotencyKey:
      typeof headers["x-github-delivery"] === "string"
        ? headers["x-github-delivery"]
        : null,
    eventType:
      typeof headers["x-github-event"] === "string"
        ? headers["x-github-event"]
        : "unknown",
  };
}
