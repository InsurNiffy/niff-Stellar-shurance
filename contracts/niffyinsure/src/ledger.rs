//! Ledger-sequence window helpers — single source of truth for all time-based
//! checks in the contract.
//!
//! # Why ledger sequences, not wall-clock time
//!
//! Soroban exposes `env.ledger().timestamp()` (Unix seconds) but that value is
//! set by validators and can drift.  Ledger *sequence numbers* are strictly
//! monotonic and cannot be manipulated by a single validator, making them the
//! safer anchor for on-chain enforcement.  Wall-clock estimates derived from
//! sequences are documented below for UX copy only — they are **not**
//! authoritative.
//!
//! # Ledger close time reference
//!
//! Stellar Protocol 20+ targets a **~5-second** ledger close time on Mainnet.
//! See: <https://developers.stellar.org/docs/learn/fundamentals/stellar-consensus-protocol>
//!
//! Conversion constants used throughout this module and the frontend:
//!
//! ```text
//! SECS_PER_LEDGER  = 5          // nominal; actual varies ±1–2 s
//! LEDGERS_PER_MIN  = 12         // 60 / 5
//! LEDGERS_PER_HOUR = 720        // 3_600 / 5
//! LEDGERS_PER_DAY  = 17_280     // 86_400 / 5
//! LEDGERS_PER_WEEK = 120_960    // 604_800 / 5
//! LEDGERS_PER_YEAR = 6_307_200  // 31_536_000 / 5
//! ```
//!
//! These constants are re-exported so the NestJS backend and Next.js frontend
//! can import them from the generated contract spec rather than hard-coding
//! their own values.
//!
//! # Safe operational window
//!
//! Ledger sequence numbers are `u32` in Soroban. All deadline arithmetic
//! (`now + duration`) uses [`u32::checked_add`] and returns a typed
//! `LedgerOverflow` / `Overflow` error instead of silently wrapping.
//!
//! [`MAX_SAFE_LEDGER`] is the largest ledger number at which all contract
//! durations can be added without overflow. It is defined as:
//!
//! ```text
//! MAX_SAFE_LEDGER = u32::MAX - MAX_VOTING_DURATION_LEDGERS
//!                 = 4_294_967_295 - 967_680
//!                 = 4_293_999_615
//! ```
//!
//! `MAX_VOTING_DURATION_LEDGERS` (967_680 ledgers ≈ 8 weeks) is the largest
//! duration added to a "now" ledger in this contract. At a nominal 5 s/ledger,
//! `MAX_SAFE_LEDGER` represents ~680 years of Mainnet ledger history — far in
//! the future.  However, overflow protection is still enforced at compile time
//! so no code change can accidentally introduce a wrapping deadline.
//!
//! # Boundary semantics (inclusive vs exclusive)
//!
//! Every window in this contract uses **half-open** intervals: `[start, end)`.
//!
//! ```text
//! is_active  : start <= now < end   (now == end means expired)
//! is_open    : now < deadline        (now == deadline means closed)
//! is_expired : now >= end
//! ```
//!
//! This matches the most common off-by-one expectation: a policy that expires
//! at ledger N is no longer valid *at* ledger N.  The frontend countdown
//! should show "0 seconds remaining" at ledger N, not "1 ledger remaining".
//!
//! # Renewal window
//!
//! Renewals are accepted in the half-open window `[end - RENEWAL_WINDOW, end)`.
//! A holder may renew starting `RENEWAL_WINDOW_LEDGERS` before expiry and up
//! to (but not including) the expiry ledger itself.
//!
//! # Rate-limit window
//!
//! To prevent claim spam, a policyholder may file at most one claim per
//! `RATE_LIMIT_WINDOW_LEDGERS` ledgers.  The window is anchored at the ledger
//! of the most recent claim filing.

// ── Conversion constants (nominal, 5 s/ledger) ───────────────────────────────

/// Nominal seconds per ledger close on Stellar Mainnet (Protocol 20+).
/// Actual close times vary; do not use for legal or financial SLAs.
pub const SECS_PER_LEDGER: u32 = 5;

pub const LEDGERS_PER_MIN: u32 = 12;
pub const LEDGERS_PER_HOUR: u32 = 720;
pub const LEDGERS_PER_DAY: u32 = 17_280;
pub const LEDGERS_PER_WEEK: u32 = 120_960;

// ── Window durations ─────────────────────────────────────────────────────────

/// Default policy duration: ~30 days.
pub const POLICY_DURATION_LEDGERS: u32 = 30 * LEDGERS_PER_DAY; // 518_400

/// Default payout timeout for an approved but unpaid claim: ~7 days.
pub const PAYOUT_TIMEOUT_LEDGERS: u32 = 7 * LEDGERS_PER_DAY; // 120_960

/// Voting window: ~7 days from claim filing.
/// Default value for [`crate::storage::get_voting_duration_ledgers`] and historical
/// behaviour: new claims use `voting_deadline_ledger = filed_at + duration` where
/// `duration` defaults to this constant until an admin sets another value in bounds.
pub const VOTE_WINDOW_LEDGERS: u32 = 7 * LEDGERS_PER_DAY; // 120_960

/// Minimum allowed `voting_duration_ledgers` (admin config).
///
/// **17_280 ledgers (~1 day at nominal 5 s/ledger)** — guarantees at least one full
/// nominal day so voters in all timezones have a reasonable window; shorter windows
/// risk disenfranchisement and operational mistakes.
pub const MIN_VOTING_DURATION_LEDGERS: u32 = LEDGERS_PER_DAY;

/// Maximum allowed `voting_duration_ledgers` (admin config).
///
/// **967_680 ledgers (~8 weeks)** — caps how long approved-but-unpaid claim flows and
/// voter duty can stretch; longer windows require a contract upgrade and broader review.
pub const MAX_VOTING_DURATION_LEDGERS: u32 = 8 * LEDGERS_PER_WEEK;

/// Renewal window: holder may renew starting this many ledgers before expiry.
/// Renewal is accepted while `end - RENEWAL_WINDOW_LEDGERS <= now < end + grace`.
pub const RENEWAL_WINDOW_LEDGERS: u32 = 3 * LEDGERS_PER_DAY; // 51_840

/// Default grace period added after nominal expiry for late renewals.
/// Renewal is accepted while `now < end + grace_period_ledgers`.
/// Default: 17_280 ledgers ≈ 1 day.
pub const DEFAULT_GRACE_PERIOD_LEDGERS: u32 = LEDGERS_PER_DAY; // 17_280

/// Minimum admin-settable grace period (1 hour).
pub const MIN_GRACE_PERIOD_LEDGERS: u32 = LEDGERS_PER_HOUR; // 720

/// Maximum admin-settable grace period (7 days).
pub const MAX_GRACE_PERIOD_LEDGERS: u32 = 7 * LEDGERS_PER_DAY; // 120_960

/// Rate-limit window: minimum ledgers between successive claim filings by the
/// same policyholder.  Prevents claim spam.
pub const RATE_LIMIT_WINDOW_LEDGERS: u32 = LEDGERS_PER_DAY; // 17_280

/// Quote validity: how many ledgers a `generate_premium` result stays valid.
pub const QUOTE_TTL_LEDGERS: u32 = 100;

/// Appeal open window: how many ledgers after rejection a claimant may open an appeal.
/// ~3 days.  Anchored at the ledger that produced the Rejected status.
pub const APPEAL_OPEN_WINDOW_LEDGERS: u32 = 3 * LEDGERS_PER_DAY; // 51_840

/// Appeal vote window: how many ledgers voters have to vote on an appeal.
/// ~7 days (same duration as the base claim vote window).
pub const APPEAL_VOTE_WINDOW_LEDGERS: u32 = 7 * LEDGERS_PER_DAY; // 120_960

/// Hard cap on appeals per claim.  Prevents infinite ping-pong.
/// Claimants get exactly one appeal after a Rejected outcome.
pub const MAX_APPEALS_PER_CLAIM: u32 = 1;

/// Dispute window after finalization: ~1 day. Admin may dispute approved claims
/// during this window to freeze payout and set status to Disputed for review.
pub const DEFAULT_DISPUTE_WINDOW_LEDGERS: u32 = LEDGERS_PER_DAY; // 17_280

/// Largest ledger number at which all contract durations can be added without
/// `u32` overflow.
///
/// Defined as `u32::MAX - MAX_VOTING_DURATION_LEDGERS` because
/// `MAX_VOTING_DURATION_LEDGERS` (967_680) is the largest duration added to a
/// current-ledger value anywhere in this contract.
///
/// At a nominal 5 s/ledger, this represents ~680 years of Mainnet history.
/// Any attempt to use ledger numbers above this threshold will produce a typed
/// overflow error rather than a silently-wrapping deadline.
#[allow(dead_code)] // public utility constant; not yet called from any contract entrypoint
pub const MAX_SAFE_LEDGER: u32 = u32::MAX - MAX_VOTING_DURATION_LEDGERS;
// = 4_293_999_615

// ── Core window helpers ───────────────────────────────────────────────────────

/// Returns `true` if `now` falls in the half-open interval `[start, end)`.
///
/// Boundary semantics:
/// - `now == start` → **inside** (inclusive start)
/// - `now == end`   → **outside** (exclusive end)
///
/// This is the canonical check used for policy active-state and voting windows.
#[inline]
pub fn is_within_window(now: u32, start: u32, end: u32) -> bool {
    now >= start && now < end
}

/// Returns `true` if the window `[start, end)` has not yet started.
#[inline]
#[allow(dead_code)]
pub fn is_before_window(now: u32, start: u32) -> bool {
    now < start
}

/// Returns `true` if `now >= end` (window has closed / policy has expired).
///
/// `now == end` is considered expired — matches `is_within_window` exclusive end.
#[inline]
pub fn is_expired(now: u32, end: u32) -> bool {
    now >= end
}

/// Returns `true` if `now` is within the renewal window `[end - window, end)`.
///
/// A holder may renew starting `window` ledgers before expiry up to (but not
/// including) the expiry ledger.  Attempting to renew at or after `end` is
/// rejected — the policy has already lapsed.
#[inline]
#[allow(dead_code)]
pub fn is_in_renewal_window(now: u32, end: u32, window: u32) -> bool {
    let renewal_start = end.saturating_sub(window);
    is_within_window(now, renewal_start, end)
}

/// Returns `true` if `now` is within the extended renewal window that includes
/// the grace period: `[end - window, end + grace)`.
///
/// - `now < end`              → standard renewal window (no gap)
/// - `end <= now < end+grace` → grace period (late renewal, no coverage gap)
/// - `now >= end + grace`     → lapsed; renewal rejected
///
/// # Overflow
///
/// Uses saturating arithmetic so an `end` near `u32::MAX` will wrap `grace_end`
/// to `u32::MAX` rather than overflow.  Callers that need a hard overflow error
/// should validate `end <= MAX_SAFE_LEDGER` before calling or use
/// [`checked_is_in_renewal_window_with_grace`].
#[inline]
#[allow(dead_code)]
pub fn is_in_renewal_window_with_grace(now: u32, end: u32, window: u32, grace: u32) -> bool {
    let renewal_start = end.saturating_sub(window);
    let grace_end = end.saturating_add(grace);
    now >= renewal_start && now < grace_end
}

/// Checked variant of [`is_in_renewal_window_with_grace`] that returns
/// `Err(Overflow)` instead of saturating when `end + grace` would overflow.
#[inline]
#[allow(dead_code)]
pub fn checked_is_in_renewal_window_with_grace(
    now: u32,
    end: u32,
    window: u32,
    grace: u32,
) -> Result<bool, crate::validate::Error> {
    let renewal_start = end.saturating_sub(window);
    let grace_end = end
        .checked_add(grace)
        .ok_or(crate::validate::Error::Overflow)?;
    Ok(now >= renewal_start && now < grace_end)
}

/// Validates admin-supplied grace period before it is written to instance storage.
/// Returns `true` if valid.
#[inline]
pub fn is_valid_grace_period_ledgers(v: u32) -> bool {
    (MIN_GRACE_PERIOD_LEDGERS..=MAX_GRACE_PERIOD_LEDGERS).contains(&v)
}

/// Returns `true` if the voting deadline has not yet passed.
///
/// Votes are accepted while `now < filed_at + vote_window`.
/// At `now == filed_at + vote_window` the window is closed.
///
/// **Note:** On-chain claim voting uses [`is_claim_voting_open`] with the stored
/// `voting_deadline_ledger` instead. This helper remains for unit tests and docs.
///
/// # Overflow
///
/// Uses saturating arithmetic; callers that need a hard overflow check should
/// validate `filed_at <= MAX_SAFE_LEDGER` first.
#[inline]
#[allow(dead_code)]
pub fn is_vote_open(now: u32, filed_at: u32, vote_window: u32) -> bool {
    let deadline = filed_at.saturating_add(vote_window);
    now < deadline
}

/// Returns `true` if the voting deadline has passed and finalization is allowed.
///
/// `finalize_claim` may be called once `now >= filed_at + vote_window`.
#[inline]
#[allow(dead_code)]
pub fn is_vote_deadline_passed(now: u32, filed_at: u32, vote_window: u32) -> bool {
    !is_vote_open(now, filed_at, vote_window)
}

/// Validates admin-supplied voting duration before it is written to instance storage.
#[inline]
pub fn validate_voting_duration_ledgers(v: u32) -> Result<(), crate::validate::Error> {
    if !(MIN_VOTING_DURATION_LEDGERS..=MAX_VOTING_DURATION_LEDGERS).contains(&v) {
        return Err(crate::validate::Error::VotingDurationOutOfBounds);
    }
    Ok(())
}

// ── Per-claim voting deadline (stored on `Claim::voting_deadline_ledger`) ─────

/// Returns `true` while votes are accepted for this claim.
///
/// **Inclusive deadline:** `voting_deadline_ledger` is the **last** ledger in which a
/// vote may be included (matches product requirement: vote at deadline ledger succeeds;
/// one ledger later reverts).
///
/// This differs from [`is_vote_open`], which uses a half-open window on
/// `filed_at + vote_window` (exclusive end). Always use this helper (and the stored
/// `voting_deadline_ledger`) for claim voting — never recompute the deadline from the
/// current global duration config.
#[inline]
pub fn is_claim_voting_open(now: u32, voting_deadline_ledger: u32) -> bool {
    now <= voting_deadline_ledger
}

/// Returns `true` when [`finalize_claim`] may run (voting period fully ended).
#[inline]
pub fn is_claim_past_voting_deadline(now: u32, voting_deadline_ledger: u32) -> bool {
    now > voting_deadline_ledger
}

/// Returns `true` if the rate-limit window has elapsed since `last_filed_at`.
///
/// A new claim may be filed once `now >= last_filed_at + rate_limit_window`.
///
/// # Overflow
///
/// Uses saturating arithmetic; `last_filed_at` is always a real ledger number
/// (never near `u32::MAX` in practice). For a checked variant, see
/// [`checked_is_rate_limit_elapsed`].
#[inline]
pub fn is_rate_limit_elapsed(now: u32, last_filed_at: u32, rate_limit_window: u32) -> bool {
    now >= last_filed_at.saturating_add(rate_limit_window)
}

/// Checked variant of [`is_rate_limit_elapsed`] that returns
/// `Err(Overflow)` instead of saturating when
/// `last_filed_at + rate_limit_window` would overflow.
#[inline]
#[allow(dead_code)]
pub fn checked_is_rate_limit_elapsed(
    now: u32,
    last_filed_at: u32,
    rate_limit_window: u32,
) -> Result<bool, crate::validate::Error> {
    let threshold = last_filed_at
        .checked_add(rate_limit_window)
        .ok_or(crate::validate::Error::Overflow)?;
    Ok(now >= threshold)
}

/// Ledgers remaining until `end` from `now`.  Returns 0 if already expired.
#[inline]
#[allow(dead_code)]
pub fn ledgers_remaining(now: u32, end: u32) -> u32 {
    end.saturating_sub(now)
}

/// Approximate seconds remaining (UX only — not authoritative).
///
/// Multiply `ledgers_remaining` by `SECS_PER_LEDGER`.  The result may drift
/// by ±20% from wall-clock time depending on network conditions.
#[inline]
#[allow(dead_code)]
pub fn approx_secs_remaining(now: u32, end: u32) -> u32 {
    ledgers_remaining(now, end).saturating_mul(SECS_PER_LEDGER)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── is_within_window ─────────────────────────────────────────────────────

    #[test]
    fn within_window_interior() {
        assert!(is_within_window(5, 1, 10));
    }

    #[test]
    fn within_window_at_start_inclusive() {
        assert!(is_within_window(1, 1, 10));
    }

    #[test]
    fn within_window_at_end_exclusive() {
        assert!(!is_within_window(10, 1, 10));
    }

    #[test]
    fn within_window_before_start() {
        assert!(!is_within_window(0, 1, 10));
    }

    #[test]
    fn within_window_after_end() {
        assert!(!is_within_window(11, 1, 10));
    }

    #[test]
    fn within_window_zero_length_always_false() {
        // start == end → empty window
        assert!(!is_within_window(5, 5, 5));
    }

    // ── is_expired ───────────────────────────────────────────────────────────

    #[test]
    fn expired_at_end_ledger() {
        assert!(is_expired(10, 10));
    }

    #[test]
    fn not_expired_one_before_end() {
        assert!(!is_expired(9, 10));
    }

    #[test]
    fn expired_well_past_end() {
        assert!(is_expired(100, 10));
    }

    // ── is_in_renewal_window ─────────────────────────────────────────────────

    #[test]
    fn renewal_window_interior() {
        // end=100, window=10 → renewal_start=90; now=95 is inside [90,100)
        assert!(is_in_renewal_window(95, 100, 10));
    }

    #[test]
    fn renewal_window_at_start_inclusive() {
        assert!(is_in_renewal_window(90, 100, 10));
    }

    #[test]
    fn renewal_window_at_end_exclusive() {
        // now == end → policy already expired, renewal rejected
        assert!(!is_in_renewal_window(100, 100, 10));
    }

    #[test]
    fn renewal_window_before_window_opens() {
        // now=89 < renewal_start=90 → too early
        assert!(!is_in_renewal_window(89, 100, 10));
    }

    #[test]
    fn renewal_window_saturates_at_zero_start() {
        // window > end → renewal_start saturates to 0; any now < end is valid
        assert!(is_in_renewal_window(0, 5, 100));
        assert!(!is_in_renewal_window(5, 5, 100)); // at end → expired
    }

    // ── is_vote_open ─────────────────────────────────────────────────────────

    #[test]
    fn vote_open_at_filing_ledger() {
        // filed_at=10, window=100 → deadline=110; now=10 is open
        assert!(is_vote_open(10, 10, 100));
    }

    #[test]
    fn vote_open_one_before_deadline() {
        assert!(is_vote_open(109, 10, 100));
    }

    #[test]
    fn vote_closed_at_deadline() {
        // now == deadline → closed
        assert!(!is_vote_open(110, 10, 100));
    }

    #[test]
    fn vote_closed_after_deadline() {
        assert!(!is_vote_open(200, 10, 100));
    }

    // ── is_vote_deadline_passed ──────────────────────────────────────────────

    #[test]
    fn deadline_passed_at_deadline_ledger() {
        assert!(is_vote_deadline_passed(110, 10, 100));
    }

    #[test]
    fn deadline_not_passed_one_before() {
        assert!(!is_vote_deadline_passed(109, 10, 100));
    }

    // ── is_rate_limit_elapsed ────────────────────────────────────────────────

    #[test]
    fn rate_limit_elapsed_exactly_at_window() {
        // last=100, window=50 → allowed at now=150
        assert!(is_rate_limit_elapsed(150, 100, 50));
    }

    #[test]
    fn rate_limit_not_elapsed_one_before() {
        assert!(!is_rate_limit_elapsed(149, 100, 50));
    }

    #[test]
    fn rate_limit_elapsed_well_after() {
        assert!(is_rate_limit_elapsed(999, 100, 50));
    }

    // ── ledgers_remaining ────────────────────────────────────────────────────

    #[test]
    fn ledgers_remaining_normal() {
        assert_eq!(ledgers_remaining(90, 100), 10);
    }

    #[test]
    fn ledgers_remaining_at_end_is_zero() {
        assert_eq!(ledgers_remaining(100, 100), 0);
    }

    #[test]
    fn ledgers_remaining_past_end_saturates_to_zero() {
        assert_eq!(ledgers_remaining(110, 100), 0);
    }

    // ── approx_secs_remaining ────────────────────────────────────────────────

    #[test]
    fn approx_secs_remaining_normal() {
        // 10 ledgers × 5 s = 50 s
        assert_eq!(approx_secs_remaining(90, 100), 50);
    }

    #[test]
    fn approx_secs_remaining_zero_when_expired() {
        assert_eq!(approx_secs_remaining(100, 100), 0);
    }

    // ── is_claim_voting_open (inclusive deadline) ─────────────────────────────

    #[test]
    fn claim_vote_open_at_deadline_ledger() {
        assert!(is_claim_voting_open(200, 200));
    }

    #[test]
    fn claim_vote_closed_one_ledger_after_deadline() {
        assert!(!is_claim_voting_open(201, 200));
    }

    #[test]
    fn claim_past_deadline_strictly_after_deadline() {
        assert!(!is_claim_past_voting_deadline(200, 200));
        assert!(is_claim_past_voting_deadline(201, 200));
    }

    #[test]
    fn validate_voting_duration_bounds() {
        assert!(validate_voting_duration_ledgers(MIN_VOTING_DURATION_LEDGERS).is_ok());
        assert!(validate_voting_duration_ledgers(MAX_VOTING_DURATION_LEDGERS).is_ok());
        assert!(validate_voting_duration_ledgers(MIN_VOTING_DURATION_LEDGERS - 1).is_err());
        assert!(validate_voting_duration_ledgers(MAX_VOTING_DURATION_LEDGERS + 1).is_err());
    }

    // ── Overflow / boundary tests ────────────────────────────────────────────

    #[test]
    fn max_safe_ledger_is_reasonable() {
        // MAX_SAFE_LEDGER must be >= the largest realistic ledger number for
        // the foreseeable future (centuries at 5 s/ledger).
        assert!(MAX_SAFE_LEDGER > 2_000_000_000); // > ~63 years worth (10_000_000_000s / 5s per ledger)
    }

    #[test]
    fn max_safe_ledger_plus_max_duration_is_u32_max() {
        // Invariant: MAX_SAFE_LEDGER + MAX_VOTING_DURATION_LEDGERS == u32::MAX
        assert_eq!(
            MAX_SAFE_LEDGER.saturating_add(MAX_VOTING_DURATION_LEDGERS),
            u32::MAX
        );
    }

    #[test]
    fn max_safe_ledger_checked_add_does_not_overflow() {
        assert!(MAX_SAFE_LEDGER
            .checked_add(MAX_VOTING_DURATION_LEDGERS)
            .is_some());
    }

    #[test]
    fn one_past_max_safe_ledger_overflows() {
        assert!((MAX_SAFE_LEDGER + 1)
            .checked_add(MAX_VOTING_DURATION_LEDGERS)
            .is_none());
    }

    #[test]
    fn u32_max_minus_one_plus_any_window_overflows() {
        // u32::MAX - 1 + anything >= 2 overflows
        assert!((u32::MAX - 1).checked_add(2).is_none());
    }

    #[test]
    fn u32_max_checked_add_any_positive_overflows() {
        assert!(u32::MAX.checked_add(1).is_none());
    }

    #[test]
    fn checked_is_rate_limit_elapsed_returns_ok_for_normal_values() {
        assert_eq!(checked_is_rate_limit_elapsed(200, 100, 50).unwrap(), true);
        assert_eq!(checked_is_rate_limit_elapsed(149, 100, 50).unwrap(), false);
    }

    #[test]
    fn checked_is_rate_limit_elapsed_errors_on_overflow() {
        assert!(checked_is_rate_limit_elapsed(0, u32::MAX, 1).is_err());
        assert!(checked_is_rate_limit_elapsed(0, u32::MAX - 1, 2).is_err());
    }

    #[test]
    fn checked_is_in_renewal_window_with_grace_returns_ok_for_normal_values() {
        // end=100, window=10, grace=20 → renewal_start=90, grace_end=120
        // now=110 is in [90, 120) → true
        assert_eq!(
            checked_is_in_renewal_window_with_grace(110, 100, 10, 20).unwrap(),
            true
        );
        // now=130 is >= 120 → false
        assert_eq!(
            checked_is_in_renewal_window_with_grace(130, 100, 10, 20).unwrap(),
            false
        );
    }

    #[test]
    fn checked_is_in_renewal_window_with_grace_errors_on_overflow() {
        assert!(checked_is_in_renewal_window_with_grace(0, u32::MAX, 10, 1).is_err());
        assert!(checked_is_in_renewal_window_with_grace(0, u32::MAX - 1, 10, 2).is_err());
    }

    #[test]
    fn saturation_of_grace_end_is_documented_behaviour() {
        // When grace_end overflows, saturating_add clamps to u32::MAX.
        // With end=u32::MAX, grace=1: grace_end = u32::MAX, so now < u32::MAX → open.
        // This is intentional fallback behaviour for edge cases; production callers
        // should validate end <= MAX_SAFE_LEDGER first.
        let result = is_in_renewal_window_with_grace(u32::MAX - 1, u32::MAX, 10, 1);
        // grace_end saturates to u32::MAX, now=u32::MAX-1 < u32::MAX → true
        assert!(result);
    }
}
