//! Policy bind/terminate: auth, voter registry, termination metadata, events.

use crate::{
    storage, token,
    types::{ClaimStatus, Policy, PolicyType, RegionTier, TerminationReason},
    validate,
};
use soroban_sdk::{contracterror, contractevent, Address, BytesN, Env, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PolicyError {
    PolicyNotFound = 1,
    Unauthorized = 2,
    AlreadyInactive = 3,
    OpenClaimsMustFinalize = 4,
    InvalidCoverage = 5,
    InvalidPremium = 6,
    InvalidTermLedgers = 7,
    LedgerOverflow = 8,
    InvalidTerminationReason = 9,
    HolderMismatch = 10,
    /// Permissionless `process_expired`: ledger is before `end_ledger + grace_period_ledgers`.
    PolicyLapseNotReached = 11,
    /// Termination blocked: a claim is currently in Processing status.
    OpenClaimInProcessing = 12,
    /// Refund transfer failed (treasury insufficient or token error).
    RefundTransferFailed = 13,
}

#[allow(dead_code)]
pub fn initiate_policy(
    env: &Env,
    holder: Address,
    policy_type: PolicyType,
    region: RegionTier,
    coverage: i128,
    premium: i128,
    term_ledgers: u32,
) -> Result<u32, PolicyError> {
    holder.require_auth();

    if coverage <= 0 {
        return Err(PolicyError::InvalidCoverage);
    }
    if premium <= 0 {
        return Err(PolicyError::InvalidPremium);
    }
    if term_ledgers == 0 {
        return Err(PolicyError::InvalidTermLedgers);
    }

    let now = env.ledger().sequence();
    let end_ledger = now
        .checked_add(term_ledgers)
        .ok_or(PolicyError::LedgerOverflow)?;

    let policy_id = storage::next_policy_id(env, &holder);

    let asset = storage::get_token(env);

    // Issue #782: query token decimals at bind time and cache for payout math.
    let token_decimals = storage::get_asset_decimals(env, &asset).unwrap_or_else(|| {
        let args = soroban_sdk::vec![env];
        env.invoke_contract::<u32>(&asset, &soroban_sdk::Symbol::new(env, "decimals"), args)
    });
    storage::set_asset_decimals(env, &asset, token_decimals);

    let policy = Policy {
        holder: holder.clone(),
        policy_id,
        policy_type,
        region,
        premium,
        coverage,
        is_active: true,
        start_ledger: now,
        end_ledger,
        asset,
        deductible: None,
        beneficiary: None,
        terminated_at_ledger: 0,
        termination_reason: TerminationReason::None,
        terminated_by_admin: false,
        strike_count: 0,
        metadata_uri: String::from_str(env, ""),
        // policy_lifecycle bindings are legacy/internal; use a non-zero sentinel.
        terms_hash: BytesN::from_array(env, &{
            let mut b = [0u8; 32];
            b[0] = 1;
            b
        }),
        token_decimals,
    };

    validate::check_policy(&policy).map_err(|e| match e {
        validate::Error::ZeroCoverage => PolicyError::InvalidCoverage,
        validate::Error::ZeroPremium => PolicyError::InvalidPremium,
        validate::Error::InvalidLedgerWindow => PolicyError::InvalidTermLedgers,
        _ => PolicyError::InvalidCoverage,
    })?;

    storage::set_policy(env, &holder, policy_id, &policy);
    storage::increment_holder_active_policies(env, &holder);
    storage::voters_ensure_holder(env, &holder);

    Ok(policy_id)
}

/// Holder-initiated termination. Blocks while `OpenClaimCount(holder, policy_id) > 0`.
/// Calculates a pro-rata refund of unused premium and transfers it from treasury to holder.
///
/// Refund formula: `premium * remaining_ledgers / total_ledgers`
/// where `remaining_ledgers = max(0, end_ledger - now)` and
/// `total_ledgers = end_ledger - start_ledger`.
///
/// Termination is blocked if any claim on this policy is in `Processing` status.
pub fn terminate_policy(
    env: &Env,
    holder: Address,
    policy_id: u32,
    reason: TerminationReason,
) -> Result<(), PolicyError> {
    holder.require_auth();
    terminate_inner(env, &holder, policy_id, reason, false, false)
}

/// Admin termination (audited).
///
/// # ⚠️  GOVERNANCE RISK: `allow_open_claims = true`
///
/// When `allow_open_claims = true`, this function terminates the policy even if
/// a claim is currently in `Processing`. The in-flight claim vote **can still
/// complete** after termination, but the following edge cases apply:
///
/// - `on_reject` will find `policy.is_active = false` and **skip** the
///   `PolicyDeactivated` branch (no double-deactivation). `StrikeIncremented`
///   and `ClaimRejected` still fire for auditability.
/// - The `PolicyTerminated` event carries `open_claim_bypass = 1` and
///   `open_claims > 0` as the on-chain warning signal for operators/indexers.
/// - Approved claims on a terminated policy can still be paid out via
///   `process_claim` — the payout guard checks claim status, not policy status.
///
/// **Operator guidance:** Only use `allow_open_claims = true` after confirming
/// with the DAO that the in-flight claim can be resolved independently. See the
/// admin runbook for the full risk matrix and recommended mitigations.
pub fn admin_terminate_policy(
    env: &Env,
    admin: Address,
    holder: Address,
    policy_id: u32,
    reason: TerminationReason,
    allow_open_claims: bool,
) -> Result<(), PolicyError> {
    admin.require_auth();
    let expected = storage::get_admin(env);
    if admin != expected {
        return Err(PolicyError::Unauthorized);
    }

    terminate_inner(env, &holder, policy_id, reason, true, allow_open_claims)
}
///
/// Policies are keyed by `(holder, policy_id)`; `holder` is a **lookup key only** (no auth).
/// Eligible when `now >= end_ledger + grace_period_ledgers`, the policy is still active, and
/// there is no open claim on that policy. Idempotent: if already inactive, returns `Ok(())`
/// and emits nothing.
///
/// Uses [`TerminationReason::LapsedNonPayment`] and emits [`PolicyExpired`] (distinct from
/// holder/admin [`PolicyTerminated`]).
#[allow(dead_code)]
pub fn process_expired(env: &Env, holder: Address, policy_id: u32) -> Result<(), PolicyError> {
    let mut policy =
        storage::get_policy(env, &holder, policy_id).ok_or(PolicyError::PolicyNotFound)?;

    if !policy.is_active {
        return Ok(());
    }

    let now = env.ledger().sequence();
    let grace = storage::get_grace_period_ledgers(env);
    let lapse_ledger = policy
        .end_ledger
        .checked_add(grace)
        .ok_or(PolicyError::LedgerOverflow)?;

    if now < lapse_ledger {
        return Err(PolicyError::PolicyLapseNotReached);
    }

    crate::policy::publish_policy_expired_if_due(env, &policy, now);

    policy.is_active = false;
    policy.terminated_at_ledger = now;
    policy.termination_reason = TerminationReason::LapsedNonPayment;
    policy.terminated_by_admin = false;

    storage::set_policy(env, &holder, policy_id, &policy);
    storage::decrement_holder_active_policies(env, &holder);
    if storage::get_holder_active_policy_count(env, &holder) == 0 {
        storage::voters_remove_holder(env, &holder);
    }

    Ok(())
}

fn terminate_inner(
    env: &Env,
    holder: &Address,
    policy_id: u32,
    reason: TerminationReason,
    by_admin: bool,
    allow_open_claim_bypass: bool,
) -> Result<(), PolicyError> {
    if reason == TerminationReason::None {
        return Err(PolicyError::InvalidTerminationReason);
    }

    let mut policy =
        storage::get_policy(env, holder, policy_id).ok_or(PolicyError::PolicyNotFound)?;

    if policy.holder != *holder {
        return Err(PolicyError::HolderMismatch);
    }

    if !policy.is_active {
        return Err(PolicyError::AlreadyInactive);
    }

    let open = storage::get_open_claim_count(env, holder, policy_id);
    if open > 0 && (!by_admin || !allow_open_claim_bypass) {
        return Err(PolicyError::OpenClaimsMustFinalize);
    }

    // Block termination if any claim on this policy is in Processing status.
    // This prevents holders from terminating to avoid a pending claim decision.
    if (!by_admin || !allow_open_claim_bypass) && has_processing_claim(env, holder, policy_id) {
        return Err(PolicyError::OpenClaimInProcessing);
    }

    let now = env.ledger().sequence();

    // Calculate pro-rata refund for unused premium.
    // refund = premium * remaining_ledgers / total_ledgers
    let refund_amount = compute_prorata_refund(&policy, now);

    policy.is_active = false;
    policy.terminated_at_ledger = now;
    policy.termination_reason = reason.clone();
    policy.terminated_by_admin = by_admin;

    storage::set_policy(env, holder, policy_id, &policy);
    storage::decrement_holder_active_policies(env, holder);
    if storage::get_holder_active_policy_count(env, holder) == 0 {
        storage::voters_remove_holder(env, holder);
    }

    // Transfer refund from treasury to holder (only for holder-initiated termination).
    // Admin terminations do not trigger automatic refunds.
    if !by_admin && refund_amount > 0 {
        let treasury = storage::get_treasury(env);
        token::transfer(env, &policy.asset, &treasury, holder, refund_amount);
    }

    emit_policy_terminated(
        env,
        holder,
        policy_id,
        reason,
        by_admin,
        allow_open_claim_bypass && open > 0,
        open,
        if !by_admin { refund_amount } else { 0 },
    );

    Ok(())
}

/// Returns true if any claim on `(holder, policy_id)` is currently in `Processing` status.
fn has_processing_claim(env: &Env, holder: &Address, policy_id: u32) -> bool {
    let claim_counter = storage::get_claim_counter(env);
    for claim_id in 1..=claim_counter {
        if let Some(claim) = storage::get_claim(env, claim_id) {
            if claim.policy_id == policy_id
                && claim.claimant == *holder
                && claim.status == ClaimStatus::Processing
            {
                return true;
            }
        }
    }
    false
}

/// Compute the pro-rata refund amount for unused premium.
///
/// Formula: `premium * remaining_ledgers / total_ledgers`
///
/// - `remaining_ledgers = max(0, end_ledger - now)` (saturating)
/// - `total_ledgers = end_ledger - start_ledger`
///
/// Returns 0 if the policy is already expired, total_ledgers is 0, or arithmetic overflows.
fn compute_prorata_refund(policy: &Policy, now: u32) -> i128 {
    let total_ledgers = policy.end_ledger.saturating_sub(policy.start_ledger);
    if total_ledgers == 0 {
        return 0;
    }
    let remaining_ledgers = policy.end_ledger.saturating_sub(now);
    if remaining_ledgers == 0 {
        return 0;
    }
    // Use i128 arithmetic to avoid overflow: premium * remaining / total
    let numerator = policy
        .premium
        .checked_mul(remaining_ledgers as i128)
        .unwrap_or(0);
    if numerator <= 0 {
        return 0;
    }
    numerator / (total_ledgers as i128)
}

#[contractevent(topics = ["niffyinsure", "policy_terminated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicyTerminated {
    #[topic]
    pub holder: Address,
    #[topic]
    pub policy_id: u32,
    pub reason_code: u32,
    pub terminated_by_admin: u32,
    pub open_claim_bypass: u32,
    pub open_claims: u32,
    pub at_ledger: u32,
    /// Pro-rata refund transferred to holder (0 for admin terminations or expired policies).
    pub refund_amount: i128,
}

fn emit_policy_terminated(
    env: &Env,
    holder: &Address,
    policy_id: u32,
    reason: TerminationReason,
    terminated_by_admin: bool,
    open_claim_bypass: bool,
    open_claims: u32,
    refund_amount: i128,
) {
    let reason_code = termination_reason_tag(reason);
    let bypass_flag: u32 = if open_claim_bypass { 1 } else { 0 };
    let admin_flag: u32 = if terminated_by_admin { 1 } else { 0 };
    PolicyTerminated {
        holder: holder.clone(),
        policy_id,
        reason_code,
        terminated_by_admin: admin_flag,
        open_claim_bypass: bypass_flag,
        open_claims,
        at_ledger: env.ledger().sequence(),
        refund_amount,
    }
    .publish(env);
}

fn termination_reason_tag(reason: TerminationReason) -> u32 {
    match reason {
        TerminationReason::None => 0,
        TerminationReason::VoluntaryCancellation => 1,
        TerminationReason::LapsedNonPayment => 2,
        TerminationReason::UnderwritingVoid => 3,
        TerminationReason::FraudOrMisrepresentation => 4,
        TerminationReason::RegulatoryAction => 5,
        TerminationReason::AdminOverride => 6,
        // 7 = ExcessiveRejections: set by the claims engine via on_reject,
        // not by the policy-lifecycle termination flow. Included here for
        // completeness; PolicyTerminated is not normally emitted for this
        // reason — PolicyDeactivated (from claim.rs) is the canonical event.
        TerminationReason::ExcessiveRejections => 7,
    }
}
