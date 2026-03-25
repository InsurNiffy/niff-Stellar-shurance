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

/// Voting window: ~7 days from claim filing.
/// Votes are accepted while `now < filed_at + VOTE_WINDOW_LEDGERS`.
pub const VOTE_WINDOW_LEDGERS: u32 = 7 * LEDGERS_PER_DAY; // 120_960

/// Renewal window: holder may renew starting this many ledgers before expiry.
/// Renewal is accepted while `end - RENEWAL_WINDOW_LEDGERS <= now < end`.
pub const RENEWAL_WINDOW_LEDGERS: u32 = 3 * LEDGERS_PER_DAY; // 51_840

/// Rate-limit window: minimum ledgers between successive claim filings by the
/// same policyholder.  Prevents claim spam.
pub const RATE_LIMIT_WINDOW_LEDGERS: u32 = LEDGERS_PER_DAY; // 17_280

/// Quote validity: how many ledgers a `generate_premium` result stays valid.
pub const QUOTE_TTL_LEDGERS: u32 = 100;

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
pub fn is_in_renewal_window(now: u32, end: u32, window: u32) -> bool {
    let renewal_start = end.saturating_sub(window);
    is_within_window(now, renewal_start, end)
}

/// Returns `true` if the voting deadline has not yet passed.
///
/// Votes are accepted while `now < filed_at + vote_window`.
/// At `now == filed_at + vote_window` the window is closed.
#[inline]
pub fn is_vote_open(now: u32, filed_at: u32, vote_window: u32) -> bool {
    let deadline = filed_at.saturating_add(vote_window);
    now < deadline
}

/// Returns `true` if the voting deadline has passed and finalization is allowed.
///
/// `finalize_claim` may be called once `now >= filed_at + vote_window`.
#[inline]
pub fn is_vote_deadline_passed(now: u32, filed_at: u32, vote_window: u32) -> bool {
    !is_vote_open(now, filed_at, vote_window)
}

/// Returns `true` if the rate-limit window has elapsed since `last_filed_at`.
///
/// A new claim may be filed once `now >= last_filed_at + rate_limit_window`.
#[inline]
pub fn is_rate_limit_elapsed(now: u32, last_filed_at: u32, rate_limit_window: u32) -> bool {
    now >= last_filed_at.saturating_add(rate_limit_window)
}

/// Ledgers remaining until `end` from `now`.  Returns 0 if already expired.
#[inline]
pub fn ledgers_remaining(now: u32, end: u32) -> u32 {
    end.saturating_sub(now)
}

/// Approximate seconds remaining (UX only — not authoritative).
///
/// Multiply `ledgers_remaining` by `SECS_PER_LEDGER`.  The result may drift
/// by ±20% from wall-clock time depending on network conditions.
#[inline]
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
}
