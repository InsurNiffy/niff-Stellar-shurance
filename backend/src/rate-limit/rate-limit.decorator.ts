/**
 * @RateLimit(policyName) decorator — attach a named rate-limit policy to a route.
 *
 * Usage:
 *   @RateLimit('claim-filing')
 *   @Post('claims')
 *   async fileClaim(...) {}
 *
 * The guard reads the policy name from route metadata and looks up the limits
 * in NAMED_RATE_LIMIT_POLICIES.  Unknown policy names fall back to the default
 * global limits.
 *
 * Health and metrics routes are exempt from all rate limiting; use
 * @RateLimit('exempt') or the built-in exemption in HttpRateLimitGuard.
 */

import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_POLICY_KEY = 'rate_limit_policy';

/**
 * Named rate-limit policy definition.
 *
 * `limit`         — maximum requests in the window
 * `windowSeconds` — sliding window size in seconds
 * `keyBy`         — 'wallet' to key by authenticated wallet address, 'ip' by remote IP
 */
export interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
  keyBy: 'wallet' | 'ip';
}

/**
 * Named policies for expensive or abuse-prone operations.
 *
 * Policy names are referenced via @RateLimit('policy-name').
 * The default policy is applied when no decorator is present.
 */
export const NAMED_RATE_LIMIT_POLICIES: Record<string, RateLimitPolicy> = {
  /** Default global limit — applied to all unannotated routes. */
  default: { limit: 100, windowSeconds: 60, keyBy: 'ip' },

  /** Claim filing — expensive on-chain operation. */
  'claim-filing': { limit: 5, windowSeconds: 3600, keyBy: 'wallet' },

  /** File uploads — bandwidth-intensive. */
  upload: { limit: 10, windowSeconds: 3600, keyBy: 'wallet' },

  /** Appeal submission — rare, high-stakes. */
  appeal: { limit: 2, windowSeconds: 3600, keyBy: 'wallet' },

  /** Auth challenge issuance — prevent nonce flooding. */
  'auth-challenge': { limit: 20, windowSeconds: 300, keyBy: 'ip' },

  /** Auth verify — prevent brute-force. */
  'auth-verify': { limit: 10, windowSeconds: 300, keyBy: 'ip' },

  /**
   * Exempt — health, metrics and other infrastructure routes.
   * The HttpRateLimitGuard short-circuits on this policy name.
   */
  exempt: { limit: Infinity, windowSeconds: 60, keyBy: 'ip' },
};

/**
 * Apply a named rate-limit policy to a controller or route handler.
 *
 * @param policyName - One of the keys in NAMED_RATE_LIMIT_POLICIES.
 *   Use 'exempt' for health-check and metrics routes.
 */
export const RateLimit = (policyName: string) =>
  SetMetadata(RATE_LIMIT_POLICY_KEY, policyName);
