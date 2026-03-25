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
}

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
        terminated_at_ledger: 0,
        termination_reason: TerminationReason::None,
        terminated_by_admin: false,
    };

    validate::check_policy(&policy).map_err(|e| match e {
        validate::Error::ZeroCoverage => PolicyError::InvalidCoverage,
        validate::Error::ZeroPremium => PolicyError::InvalidPremium,
        validate::Error::InvalidLedgerWindow => PolicyError::InvalidTermLedgers,
        _ => PolicyError::InvalidCoverage,
    })?;

    storage::set_policy(env, &policy);
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

/// Admin termination (audited). `allow_open_claims` documents explicit acceptance
/// that in-flight claims may lack a normal resolution path — indexers read the flag.
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
    policy.termination_reason = reason;
    policy.terminated_by_admin = by_admin;

    storage::set_policy(env, &policy);
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
    }
}
