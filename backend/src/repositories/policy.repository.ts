/**
 * Policy repository — all data access goes through here.
 *
 * Query strategy (no N+1)
 * ───────────────────────
 * `listPolicies` returns a filtered+sorted slice, then calls
 * `getClaimsBatch` once with all (holder, policy_id) pairs on that page.
 * This is a single-pass batch fetch, equivalent to a SQL JOIN, giving
 * O(page_size) claim lookups instead of O(page_size) individual queries.
 */

import {
  allPoliciesOrdered,
  getClaimsBatch,
  getClaimsByPolicy,
  getPolicyByComposite,
} from "../db/store";
import { Claim, Policy } from "../types/policy";

export type PolicyFilter = {
  /** "active" → is_active=true, "expired" → is_active=false, omit for all */
  status?: "active" | "expired";
  /** Filter to a specific holder address */
  holder?: string;
};

export interface PolicyWithClaims {
  policy: Policy;
  claims: Claim[];
}

/**
 * Returns all policies matching `filter`, sorted ascending by global_seq
 * (stable insertion order). Claims are batch-fetched — no N+1.
 */
export function listPolicies(filter: PolicyFilter): PolicyWithClaims[] {
  let policies = allPoliciesOrdered(); // already sorted by global_seq ASC

  if (filter.status === "active") {
    policies = policies.filter((p) => p.is_active);
  } else if (filter.status === "expired") {
    policies = policies.filter((p) => !p.is_active);
  }

  if (filter.holder) {
    const h = filter.holder;
    policies = policies.filter((p) => p.holder === h);
  }

  // Batch-fetch all claims for this page in one pass — avoids N+1
  const claimsMap = getClaimsBatch(
    policies.map((p) => ({ holder: p.holder, policy_id: p.policy_id }))
  );

  return policies.map((p) => ({
    policy: p,
    claims: claimsMap.get(`${p.holder}:${p.policy_id}`) ?? [],
  }));
}

/**
 * Fetches a single policy by holder address and per-holder policy_id.
 * Returns undefined if not found.
 */
export function getPolicy(
  holder: string,
  policy_id: number
): PolicyWithClaims | undefined {
  const policy = getPolicyByComposite(holder, policy_id);
  if (!policy) return undefined;
  const claims = getClaimsByPolicy(holder, policy_id);
  return { policy, claims };
}
