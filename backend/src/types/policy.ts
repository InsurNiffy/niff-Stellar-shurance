/**
 * Domain types mirroring the on-chain Soroban contract structs.
 * All token amounts are i128 stroops represented as strings to avoid
 * floating-point precision loss. 1 stroop = 0.0000001 XLM (7 decimals).
 */

export type PolicyType = "Auto" | "Health" | "Property";
export type RegionTier = "Low" | "Medium" | "High";
export type ClaimStatus = "Processing" | "Approved" | "Rejected";

/** On-chain Policy record (internal representation). */
export interface Policy {
  /** Composite key component: policyholder Stellar address. */
  holder: string;
  /** Per-holder monotonic u32 (starts at 1). Not globally unique alone. */
  policy_id: number;
  policy_type: PolicyType;
  region: RegionTier;
  /** Annual premium in stroops (i128 stored as string). */
  premium: string;
  /** Maximum claim payout in stroops (i128 stored as string). */
  coverage: string;
  is_active: boolean;
  /** Ledger sequence when the policy became active. */
  start_ledger: number;
  /** Ledger sequence when the policy expires. */
  end_ledger: number;
  /** Globally unique surrogate key for cursor pagination (assigned at insert). */
  global_seq: number;
}

/** On-chain Claim record (internal representation). */
export interface Claim {
  /** Global monotonic u64 claim identifier. */
  claim_id: number;
  /** References Policy(holder, policy_id). */
  policy_id: number;
  /** Must equal policy.holder. */
  claimant: string;
  /** Requested payout in stroops (i128 stored as string). */
  amount: string;
  /** ≤ 256 bytes. */
  details: string;
  /** ≤ 5 IPFS URLs, each ≤ 128 bytes. */
  image_urls: string[];
  status: ClaimStatus;
  approve_votes: number;
  reject_votes: number;
}
