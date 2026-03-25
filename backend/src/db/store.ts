/**
 * In-memory data store with indexed maps for O(1) lookups and
 * sorted insertion order for stable cursor-based pagination.
 *
 * Indexes maintained:
 *   - byGlobalSeq: Map<global_seq, Policy>  — primary cursor index
 *   - byHolder:    Map<holder, Policy[]>     — filter by holder
 *   - byComposite: Map<"holder:policy_id", Policy> — point lookup
 *
 * All writes go through `insertPolicy` / `upsertPolicy` to keep indexes
 * consistent. Concurrent inserts are safe because JS is single-threaded.
 */

import { Claim, Policy } from "../types/policy";

let _seq = 0;

const byGlobalSeq = new Map<number, Policy>();
const byHolder = new Map<string, Policy[]>();
const byComposite = new Map<string, Policy>();

const claims = new Map<number, Claim>();
/** claim_id → policy composite key, for join without N+1 */
const claimsByComposite = new Map<string, Claim[]>();

function compositeKey(holder: string, policy_id: number): string {
  return `${holder}:${policy_id}`;
}

export function insertPolicy(p: Omit<Policy, "global_seq">): Policy {
  _seq += 1;
  const record: Policy = { ...p, global_seq: _seq };
  const ck = compositeKey(p.holder, p.policy_id);

  byGlobalSeq.set(_seq, record);
  byComposite.set(ck, record);

  const holderList = byHolder.get(p.holder) ?? [];
  holderList.push(record);
  byHolder.set(p.holder, holderList);

  return record;
}

export function upsertPolicy(p: Omit<Policy, "global_seq">): Policy {
  const ck = compositeKey(p.holder, p.policy_id);
  const existing = byComposite.get(ck);
  if (existing) {
    // Update in-place, preserving global_seq for stable pagination
    Object.assign(existing, p);
    return existing;
  }
  return insertPolicy(p);
}

export function getPolicyByComposite(
  holder: string,
  policy_id: number
): Policy | undefined {
  return byComposite.get(compositeKey(holder, policy_id));
}

export function getPolicyBySeq(seq: number): Policy | undefined {
  return byGlobalSeq.get(seq);
}

/** Returns all policies in ascending global_seq order. */
export function allPoliciesOrdered(): Policy[] {
  return Array.from(byGlobalSeq.values());
}

export function getPoliciesByHolder(holder: string): Policy[] {
  return byHolder.get(holder) ?? [];
}

// ── Claims ───────────────────────────────────────────────────────────────────

export function insertClaim(c: Claim): void {
  claims.set(c.claim_id, c);
  const ck = compositeKey(c.claimant, c.policy_id);
  const list = claimsByComposite.get(ck) ?? [];
  list.push(c);
  claimsByComposite.set(ck, list);
}

export function getClaimsByPolicy(holder: string, policy_id: number): Claim[] {
  return claimsByComposite.get(compositeKey(holder, policy_id)) ?? [];
}

/** Bulk-fetch claims for a list of (holder, policy_id) pairs — avoids N+1. */
export function getClaimsBatch(
  keys: Array<{ holder: string; policy_id: number }>
): Map<string, Claim[]> {
  const result = new Map<string, Claim[]>();
  for (const { holder, policy_id } of keys) {
    const ck = compositeKey(holder, policy_id);
    result.set(ck, claimsByComposite.get(ck) ?? []);
  }
  return result;
}

/** Reset store — used in tests only. */
export function _resetStore(): void {
  _seq = 0;
  byGlobalSeq.clear();
  byHolder.clear();
  byComposite.clear();
  claims.clear();
  claimsByComposite.clear();
}
