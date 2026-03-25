/**
 * Verification dispatcher — routes to the correct provider verifier and
 * extracts idempotency key + event type.
 *
 * IP allowlisting
 * ───────────────
 * If `config.ipAllowlist` is non-empty, the request IP must be in the list.
 * Supports exact IPv4/IPv6 matches. CIDR support can be added by replacing
 * the exact-match check with a CIDR library (e.g. `ip-range-check`) — the
 * interface is unchanged.
 */

import { IncomingHttpHeaders } from "http";
import { ProviderConfig, VerifyResult, WebhookProvider } from "../types/webhook";
import { verifyGitHub, extractGitHubMeta } from "./providers/github";
import { verifyStripe, extractStripeMeta } from "./providers/stripe";
import { verifyGeneric, extractGenericMeta } from "./providers/generic";

export interface VerifyContext {
  provider: WebhookProvider;
  rawBody: Buffer;
  headers: IncomingHttpHeaders;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsedBody: Record<string, any>;
  config: ProviderConfig;
  clientIp: string;
  nowSeconds?: number;
}

export interface VerifyOutput {
  result: VerifyResult;
  idempotencyKey: string | null;
  eventType: string;
}

function isIpAllowed(ip: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  // Exact match only — extend with CIDR library for production
  return allowlist.includes(ip);
}

export function verifyWebhook(ctx: VerifyContext): VerifyOutput {
  const { provider, rawBody, headers, parsedBody, config, clientIp, nowSeconds } = ctx;

  // IP allowlist check (before signature — fail fast, no timing leak)
  if (config.ipAllowlist && config.ipAllowlist.length > 0) {
    if (!isIpAllowed(clientIp, config.ipAllowlist)) {
      return {
        result: { ok: false, reason: "ip_blocked" },
        idempotencyKey: null,
        eventType: "unknown",
      };
    }
  }

  switch (provider) {
    case "github": {
      const result = verifyGitHub(rawBody, headers, config);
      const meta = extractGitHubMeta(headers);
      return { result, ...meta };
    }
    case "stripe": {
      const result = verifyStripe(rawBody, headers, config, nowSeconds);
      const meta = extractStripeMeta(parsedBody);
      return { result, ...meta };
    }
    case "generic": {
      const result = verifyGeneric(rawBody, headers, config, nowSeconds);
      const meta = extractGenericMeta(headers);
      return { result, ...meta };
    }
    default: {
      return {
        result: { ok: false, reason: "unknown_provider" },
        idempotencyKey: null,
        eventType: "unknown",
      };
    }
  }
}
