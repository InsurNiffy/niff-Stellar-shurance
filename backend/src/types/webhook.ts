/**
 * Webhook domain types.
 *
 * Provider support matrix:
 *   github  — HMAC-SHA256, X-Hub-Signature-256, X-GitHub-Delivery (idempotency key)
 *   stripe  — Stripe-Signature (t=timestamp,v1=sig), Stripe-specific tolerance
 *   generic — HMAC-SHA256, X-Webhook-Signature, X-Webhook-Id
 */

export type WebhookProvider = "github" | "stripe" | "generic";

/** Per-provider secret configuration. Supports multiple active secrets for
 *  zero-downtime rotation: verification passes if ANY secret matches. */
export interface ProviderConfig {
  /** One or more active secrets. List both old and new during rotation. */
  secrets: string[];
  /** Allowed timestamp skew in seconds. Default: 300 (5 min). */
  toleranceSeconds?: number;
  /** Optional CIDR allowlist. If set, requests from outside are rejected. */
  ipAllowlist?: string[];
}

export type WebhookConfig = Record<WebhookProvider, ProviderConfig>;

/** Payload enqueued into the job queue after successful verification. */
export interface WebhookJob {
  provider: WebhookProvider;
  /** Provider-supplied idempotency key (delivery ID, event ID, etc.). */
  idempotencyKey: string;
  /** Raw event type string from provider headers. */
  eventType: string;
  /** Parsed JSON body. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
  /** Unix timestamp (seconds) when the webhook was received. */
  receivedAt: number;
}

/** Result of a signature verification attempt. */
export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "invalid_signature" | "replay" | "missing_header" | "unknown_provider" | "ip_blocked" };
