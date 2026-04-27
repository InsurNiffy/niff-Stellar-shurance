//! Policy bind/terminate: auth, voter registry, termination metadata, events.

use crate::{
    storage,
    types::{Policy, PolicyType, RegionTier, TerminationReason},
    validate,
};
use soroban_sdk::{contracterror, contractevent, Address, Env};

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
        asset: storage::get_token(env),
        deductible: None,
        beneficiary: None,
        terminated_at_ledger: 0,
        termination_reason: TerminationReason::None,
        terminated_by_admin: false,
        strike_count: 0,
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

/// Permissionless keeper: mark a policy inactive after the renewal + grace window has ended.
///
/// Policies are keyed by `(holder, policy_id)`; `holder` is a **lookup key only** (no auth).
/// Eligible when `now >= end_ledger + grace_period_ledgers`, the policy is still active, and
/// there is no open claim on that policy. Idempotent: if already inactive, returns `Ok(())`
/// and emits nothing.
///
/// Uses [`TerminationReason::LapsedNonPayment`] and emits [`PolicyExpired`] (distinct from
/// holder/admin [`PolicyTerminated`]).
pub fn process_expired(env: &Env, holder: Address, policy_id: u32) -> Result<(), PolicyError> {
    let mut policy = storage::get_policy(env, &holder, policy_id).ok_or(PolicyError::PolicyNotFound)?;

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

    if storage::has_open_claim(env, &holder, policy_id) {
        return Err(PolicyError::OpenClaimsMustFinalize);
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

    let now = env.ledger().sequence();
    policy.is_active = false;
    policy.terminated_at_ledger = now;
    policy.termination_reason = reason.clone();
    policy.terminated_by_admin = by_admin;

    storage::set_policy(env, holder, policy_id, &policy);
    storage::decrement_holder_active_policies(env, holder);
    if storage::get_holder_active_policy_count(env, holder) == 0 {
        storage::voters_remove_holder(env, holder);
    }

    emit_policy_terminated(
        env,
        holder,
        policy_id,
        reason,
        by_admin,
        allow_open_claim_bypass && open > 0,
        open,
    );

    Ok(())
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
}

fn emit_policy_terminated(
    env: &Env,
    holder: &Address,
    policy_id: u32,
    reason: TerminationReason,
    terminated_by_admin: bool,
    open_claim_bypass: bool,
    open_claims: u32,
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
