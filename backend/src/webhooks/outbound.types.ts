/** Shared types for outbound webhook jobs (#1484). */

export interface OutboundWebhookJob {
  targetUrl: string;
  eventType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  /** HMAC secret used for X-Niffy-Signature (optional for legacy subscribers). */
  secret?: string;
  /** 1-based delivery attempt. */
  attempt?: number;
}
