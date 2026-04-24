/**
 * Per-provider webhook secret configuration.
 *
 * Zero-downtime secret rotation
 * ─────────────────────────────
 * Each provider accepts an array of secrets. During rotation:
 *   1. Add the NEW secret to the array alongside the OLD one.
 *   2. Deploy. Verification now accepts both.
 *   3. Update the secret at the provider (GitHub/Stripe dashboard).
 *   4. Remove the OLD secret from the array and redeploy.
 *
 * This ensures no webhook is rejected during the rotation window.
 *
 * IP allowlisting (optional)
 * ──────────────────────────
 * Set `ipAllowlist` to a list of exact IPs or CIDR blocks.
 * GitHub publishes its hook IPs at https://api.github.com/meta (hooks key).
 * Stripe publishes theirs at https://stripe.com/docs/ips.
 * Leave undefined to skip IP checks (default).
 */

import { WebhookConfig } from "../types/webhook";
import { getRuntimeEnv } from '../config/runtime-env';

const env = getRuntimeEnv();

function requireEnv(key: 'WEBHOOK_SECRET_GITHUB' | 'WEBHOOK_SECRET_STRIPE' | 'WEBHOOK_SECRET_GENERIC'): string {
  const val = env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optionalEnvList(
  key:
    | 'WEBHOOK_IP_ALLOWLIST_GITHUB'
    | 'WEBHOOK_IP_ALLOWLIST_STRIPE'
    | 'WEBHOOK_IP_ALLOWLIST_GENERIC',
): string[] {
  const val = env[key];
  if (!val) return [];
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}

export function buildWebhookConfig(): WebhookConfig {
  return {
    github: {
      secrets: [requireEnv("WEBHOOK_SECRET_GITHUB")],
      toleranceSeconds: 300,
      ipAllowlist: optionalEnvList("WEBHOOK_IP_ALLOWLIST_GITHUB"),
    },
    stripe: {
      secrets: [requireEnv("WEBHOOK_SECRET_STRIPE")],
      toleranceSeconds: 300,
      ipAllowlist: optionalEnvList("WEBHOOK_IP_ALLOWLIST_STRIPE"),
    },
    generic: {
      secrets: [requireEnv("WEBHOOK_SECRET_GENERIC")],
      toleranceSeconds: 300,
      ipAllowlist: optionalEnvList("WEBHOOK_IP_ALLOWLIST_GENERIC"),
    },
  };
}

// Singleton — rebuilt on each import in tests via dependency injection
let _config: WebhookConfig | null = null;

export function getWebhookConfig(): WebhookConfig {
  if (!_config) _config = buildWebhookConfig();
  return _config;
}

/** Override config — used in tests. */
export function setWebhookConfig(cfg: WebhookConfig): void {
  _config = cfg;
}

export function resetWebhookConfig(): void {
  _config = null;
}
