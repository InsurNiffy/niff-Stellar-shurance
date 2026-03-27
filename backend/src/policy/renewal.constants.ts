/**
 * Ledger-bounded renewal window constants.
 *
 * RENEWAL WINDOW SEMANTICS
 * ─────────────────────────────────────────────────────────────────────────────
 * A renewal is valid when the current ledger falls within the half-open interval:
 *
 *   [policy.endLedger - RENEWAL_OPEN_LEDGERS_BEFORE_EXPIRY,
 *    policy.endLedger + RENEWAL_GRACE_LEDGERS_AFTER_EXPIRY)
 *
 * Inclusive lower bound:
 *   currentLedger >= policy.endLedger - RENEWAL_OPEN_LEDGERS_BEFORE_EXPIRY
 *   Renewals attempted before this ledger are rejected with RENEWAL_TOO_EARLY.
 *
 * Exclusive upper bound:
 *   currentLedger < policy.endLedger + RENEWAL_GRACE_LEDGERS_AFTER_EXPIRY
 *   Renewals attempted at or after this ledger are rejected with RENEWAL_TOO_LATE.
 *   The upper bound is exclusive so that a policy expiring at ledger N and a
 *   grace period of G means the last valid renewal ledger is N+G-1.
 *
 * LEDGER TIME ASSUMPTIONS
 * ─────────────────────────────────────────────────────────────────────────────
 * Stellar closes a ledger approximately every 5 seconds (SECONDS_PER_LEDGER).
 * This is a statistical average; individual ledger close times vary ±1–2 s.
 *
 * SERVER-CLIENT SKEW CONSIDERATIONS
 * ─────────────────────────────────────────────────────────────────────────────
 * The backend fetches the authoritative ledger sequence from the Soroban RPC
 * (server.getLatestLedger()) and uses that for all window checks.
 *
 * Frontend countdown UIs should:
 *   1. Fetch currentLedger from GET /health or a dedicated /ledger endpoint.
 *   2. Compute estimated wall-clock time as:
 *        remainingLedgers * SECONDS_PER_LEDGER seconds
 *   3. Add a UI buffer of ~2 ledgers (~10 s) to account for RPC propagation
 *      lag and the time between the user clicking "Renew" and the backend
 *      receiving the request.
 *   4. Never rely on Date.now() alone — ledger sequence is the canonical clock.
 *
 * The backend does NOT add any skew buffer; it enforces the window exactly as
 * defined by the constants below. Frontends should open the renewal UI slightly
 * before RENEWAL_OPEN_LEDGERS_BEFORE_EXPIRY to absorb network latency.
 */

/** Approximate ledger close time in seconds (Stellar mainnet/testnet average). */
export const SECONDS_PER_LEDGER = 5;

/**
 * Standard policy duration in ledgers (~1 year at 5 s/ledger).
 * 365 days × 24 h × 3600 s / 5 s = 6,307,200 ledgers.
 */
export const POLICY_DURATION_LEDGERS = 6_307_200;

/**
 * How many ledgers before policy.endLedger the renewal window opens.
 * Inclusive lower bound: currentLedger >= endLedger - RENEWAL_OPEN_LEDGERS_BEFORE_EXPIRY.
 *
 * Default: 120,960 ledgers ≈ 7 days (120,960 × 5 s = 604,800 s).
 */
export const RENEWAL_OPEN_LEDGERS_BEFORE_EXPIRY = 120_960;

/**
 * How many ledgers after policy.endLedger the grace window closes.
 * Exclusive upper bound: currentLedger < endLedger + RENEWAL_GRACE_LEDGERS_AFTER_EXPIRY.
 *
 * Default: 17,280 ledgers ≈ 1 day (17,280 × 5 s = 86,400 s).
 * The last valid renewal ledger is endLedger + RENEWAL_GRACE_LEDGERS_AFTER_EXPIRY - 1.
 */
export const RENEWAL_GRACE_LEDGERS_AFTER_EXPIRY = 17_280;

/**
 * Claim states that block renewal.
 *
 * OPEN-CLAIM RULE (product specification):
 *   A policy with a claim in PENDING status (on-chain: "Processing") cannot be
 *   renewed until the claim is finalized (APPROVED, PAID, or REJECTED).
 *
 *   Rationale: allowing renewal while a claim is unresolved creates ambiguity
 *   about which policy term covers the outstanding liability. The contract
 *   enforces this on-chain; the backend mirrors it to provide early rejection
 *   with a clear error code before building an unsigned transaction.
 *
 *   APPROVED claims are NOT blocking: the claim has been decided; only payment
 *   disbursement is pending, which does not affect the new policy term.
 */
export const BLOCKING_CLAIM_STATUSES = ['PENDING'] as const;
export type BlockingClaimStatus = (typeof BLOCKING_CLAIM_STATUSES)[number];
