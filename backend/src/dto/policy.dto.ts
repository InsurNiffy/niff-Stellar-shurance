/**
 * Response DTOs for the policies API.
 *
 * Design rules
 * ────────────
 * - No internal fields (global_seq, admin keys) are exposed.
 * - All token amounts are strings representing i128 stroops.
 *   Decimals: 7 (1 stroop = 0.0000001 XLM).
 * - Floating-point values are never used for amounts.
 * - Fields are documented with JSDoc for OpenAPI generation.
 */

import { Claim, Policy } from "../types/policy";

/** Summary of a related claim, linked from a policy response. */
export interface ClaimSummaryDto {
  /**
   * Global monotonic claim identifier.
   * @example 42
   */
  claim_id: number;
  /**
   * Requested payout in stroops (7 decimals, string to avoid float).
   * @example "50000000"
   */
  amount: string;
  /**
   * Current claim lifecycle state.
   * @example "Processing"
   */
  status: "Processing" | "Approved" | "Rejected";
  /** Number of approve votes cast by policyholders. */
  approve_votes: number;
  /** Number of reject votes cast by policyholders. */
  reject_votes: number;
  /**
   * Link to the full claim resource.
   * @example "/claims/42"
   */
  _link: string;
}

/**
 * Coverage summary for the Next.js dashboard coverage card.
 * All amounts in stroops (string, 7 decimals).
 */
export interface CoverageSummaryDto {
  /**
   * Maximum payout in stroops.
   * @example "500000000"
   */
  coverage_amount: string;
  /**
   * Annual premium in stroops.
   * @example "5000000"
   */
  premium_amount: string;
  /**
   * ISO 4217 currency code for the token used.
   * Always "XLM" for the Stellar-native token.
   * @example "XLM"
   */
  currency: "XLM";
  /**
   * Number of decimal places for all stroop amounts.
   * Always 7: divide by 10^7 to get XLM.
   * @example 7
   */
  decimals: 7;
}

/**
 * Expiry countdown inputs for the Next.js dashboard timer widget.
 * Ledger-based; the frontend converts to wall-clock time using
 * average ledger close time (~5 seconds on Stellar mainnet).
 */
export interface ExpiryCountdownDto {
  /** Ledger sequence when the policy became active. */
  start_ledger: number;
  /** Ledger sequence when the policy expires. */
  end_ledger: number;
  /**
   * Remaining ledgers until expiry (end_ledger - current_ledger).
   * Negative if already expired. Frontend uses this for countdown display.
   */
  ledgers_remaining: number;
  /**
   * Average ledger close time in seconds (Stellar mainnet ≈ 5s).
   * Use this to convert ledgers_remaining to wall-clock seconds.
   * @example 5
   */
  avg_ledger_close_seconds: 5;
}

/** Full policy response DTO — safe for public API consumers. */
export interface PolicyDto {
  /**
   * Policyholder Stellar address (G... format).
   * @example "GABC1111111111111111111111111111111111111111111111111111"
   */
  holder: string;
  /**
   * Per-holder policy identifier (u32, starts at 1).
   * Not globally unique; use holder + policy_id together as a key.
   * @example 1
   */
  policy_id: number;
  /**
   * Coverage category.
   * @example "Auto"
   */
  policy_type: "Auto" | "Health" | "Property";
  /**
   * Geographic risk tier used for premium calculation.
   * @example "Medium"
   */
  region: "Low" | "Medium" | "High";
  /**
   * Whether the policy is currently active.
   * @example true
   */
  is_active: boolean;
  /** Coverage summary including amounts and currency metadata. */
  coverage_summary: CoverageSummaryDto;
  /** Expiry countdown inputs for the dashboard timer widget. */
  expiry_countdown: ExpiryCountdownDto;
  /**
   * Summaries of all claims filed against this policy.
   * Empty array if no claims exist.
   */
  claims: ClaimSummaryDto[];
  /**
   * Self-link for this policy resource.
   * @example "/policies/GABC.../1"
   */
  _link: string;
}

/** Paginated list response wrapper. */
export interface PolicyListDto {
  data: PolicyDto[];
  /**
   * Opaque cursor for the next page. Pass as `after` query param.
   * Null when there are no more pages.
   * @example "MjA"
   */
  next_cursor: string | null;
  /**
   * Total policies matching the applied filters (before pagination).
   * @example 42
   */
  total: number;
}

// ── Mappers ──────────────────────────────────────────────────────────────────

/** Simulated current ledger sequence (replace with real chain query in prod). */
const SIMULATED_CURRENT_LEDGER = 5000;

export function toClaimSummaryDto(c: Claim): ClaimSummaryDto {
  return {
    claim_id: c.claim_id,
    amount: c.amount,
    status: c.status,
    approve_votes: c.approve_votes,
    reject_votes: c.reject_votes,
    _link: `/claims/${c.claim_id}`,
  };
}

export function toPolicyDto(p: Policy, claims: Claim[]): PolicyDto {
  return {
    holder: p.holder,
    policy_id: p.policy_id,
    policy_type: p.policy_type,
    region: p.region,
    is_active: p.is_active,
    coverage_summary: {
      coverage_amount: p.coverage,
      premium_amount: p.premium,
      currency: "XLM",
      decimals: 7,
    },
    expiry_countdown: {
      start_ledger: p.start_ledger,
      end_ledger: p.end_ledger,
      ledgers_remaining: p.end_ledger - SIMULATED_CURRENT_LEDGER,
      avg_ledger_close_seconds: 5,
    },
    claims: claims.map(toClaimSummaryDto),
    _link: `/policies/${encodeURIComponent(p.holder)}/${p.policy_id}`,
  };
}
