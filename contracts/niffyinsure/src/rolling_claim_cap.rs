//! Rolling per-policy claim cap over a **ledger-anchored** window.
//!
//! # What is counted
//! Only **paid** amounts (when `process_claim` succeeds) add to `cumulative_paid`.
//! At `file_claim` we require `cumulative_paid + new_amount <= cap` for the **current**
//! window bucket, so at most one open claim per policy (`DuplicateOpenClaim`) keeps the
//! check consistent with paid totals.
//!
//! # Deductible / net vs gross (product note)
//! This MVP applies the cap to **gross** on-chain `claim.amount` (the same field used for
//! payout). If a deductible or net-of-deductible payout is introduced later, explicitly
//! define whether the rolling accumulator uses gross filed amount, net paid amount, or both.
//!
//! # Cap / window changes
//! Admin updates apply to **future** `file_claim` calls only. `process_claim` does not
//! re-validate the cap — in-flight approved claims pay even if the cap was lowered after filing.

use soroban_sdk::{contractevent, Address, Env};

use crate::{
    admin::AdminError,
    storage,
    types::RollingClaimWindowState,
    validate::Error,
};

/// Minimum rolling cap (when admin configures a finite cap).
pub const MIN_ROLLING_CLAIM_CAP: i128 = 1;
/// Upper bound to avoid absurd configuration (adjust per asset decimals in production).
pub const MAX_ROLLING_CLAIM_CAP: i128 = 9_999_999_999_999_999;

pub const MIN_ROLLING_WINDOW_LEDGERS: u32 = 100;
pub const MAX_ROLLING_WINDOW_LEDGERS: u32 = 100_000_000;

#[contractevent(topics = ["niffyinsure", "claim_cap_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimCapUpdated {
    pub old_cap: i128,
    pub new_cap: i128,
}

#[contractevent(topics = ["niffyinsure", "rolling_claim_window_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RollingClaimWindowLedgersUpdated {
    pub old_window_ledgers: u32,
    pub new_window_ledgers: u32,
}

#[inline]
fn window_bucket_start(now: u32, window_len: u32) -> u32 {
    if window_len == 0 {
        return 0;
    }
    now.saturating_div(window_len).saturating_mul(window_len)
}

/// Initialise defaults at contract `initialize` (effectively uncapped until admin sets a cap).
pub fn init_defaults(env: &Env) {
    storage::set_rolling_claim_cap(env, i128::MAX);
    storage::set_rolling_claim_window_ledgers(env, 1_000_000);
}

fn sync_state_to_ledger(
    env: &Env,
    holder: &Address,
    policy_id: u32,
    now: u32,
) -> RollingClaimWindowState {
    let wlen = storage::get_rolling_claim_window_ledgers(env);
    let expected_start = window_bucket_start(now, wlen);
    match storage::get_rolling_claim_state(env, holder, policy_id) {
        Some(s) if s.window_start == expected_start => s,
        _ => RollingClaimWindowState {
            window_start: expected_start,
            cumulative_paid: 0,
        },
    }
}

fn persist_state(
    env: &Env,
    holder: &Address,
    policy_id: u32,
    state: &RollingClaimWindowState,
) {
    storage::set_rolling_claim_state(env, holder, policy_id, state);
}

/// Validate before accepting a new claim amount.
pub fn check_file_claim(
    env: &Env,
    holder: &Address,
    policy_id: u32,
    amount: i128,
    now: u32,
) -> Result<(), Error> {
    let cap = storage::get_rolling_claim_cap(env);
    if cap == i128::MAX {
        return Ok(());
    }
    let state = sync_state_to_ledger(env, holder, policy_id, now);
    let sum = state
        .cumulative_paid
        .checked_add(amount)
        .ok_or(Error::Overflow)?;
    if sum > cap {
        return Err(Error::RollingClaimCapExceeded);
    }
    // Persist rolled state if we reset the bucket (so storage matches reads).
    persist_state(env, holder, policy_id, &state);
    Ok(())
}

/// Add a successful payout to the rolling accumulator (no cap check — in-flight safety).
pub fn record_claim_paid(env: &Env, holder: &Address, policy_id: u32, amount: i128, now: u32) {
    let mut state = sync_state_to_ledger(env, holder, policy_id, now);
    state.cumulative_paid = state.cumulative_paid.saturating_add(amount);
    persist_state(env, holder, policy_id, &state);
}

/// Remaining headroom under the rolling cap for this policy/window (ignores per-claim coverage).
pub fn remaining_under_cap(env: &Env, holder: &Address, policy_id: u32, now: u32) -> i128 {
    let cap = storage::get_rolling_claim_cap(env);
    if cap == i128::MAX {
        return i128::MAX;
    }
    let state = sync_state_to_ledger(env, holder, policy_id, now);
    cap.saturating_sub(state.cumulative_paid).max(0)
}

pub fn try_set_cap(env: &Env, new_cap: i128) -> Result<(), AdminError> {
    if new_cap != i128::MAX && (new_cap < MIN_ROLLING_CLAIM_CAP || new_cap > MAX_ROLLING_CLAIM_CAP)
    {
        return Err(AdminError::RollingClaimCapOutOfBounds);
    }
    let old = storage::get_rolling_claim_cap(env);
    storage::set_rolling_claim_cap(env, new_cap);
    storage::bump_instance(env);
    ClaimCapUpdated { old_cap: old, new_cap }.publish(env);
    Ok(())
}

pub fn try_set_window_ledgers(env: &Env, new_window: u32) -> Result<(), AdminError> {
    if new_window < MIN_ROLLING_WINDOW_LEDGERS || new_window > MAX_ROLLING_WINDOW_LEDGERS {
        return Err(AdminError::RollingClaimWindowOutOfBounds);
    }
    let old = storage::get_rolling_claim_window_ledgers(env);
    storage::set_rolling_claim_window_ledgers(env, new_window);
    storage::bump_instance(env);
    RollingClaimWindowLedgersUpdated {
        old_window_ledgers: old,
        new_window_ledgers: new_window,
    }
    .publish(env);
    Ok(())
}
