use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    /// (holder, policy_id) — policy_id is per-holder u32
    Policy(Address, u32),
    /// Per-holder policy counter; next policy_id = counter + 1
    PolicyCounter(Address),
    Claim(u64),
    /// (claim_id, voter_address) → VoteOption
    Vote(u64, Address),
    /// Vec<Address> of all current active policyholders (voters)
    Voters,
    /// Global monotonic claim id counter
    ClaimCounter,
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

/// Used by initialize and admin drain (feat/admin).
#[allow(dead_code)]
pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

/// Used by claim payout (feat/claim-voting).
#[allow(dead_code)]
pub fn get_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

/// Returns the next policy_id for `holder` and increments the counter.
/// Uses checked_add to panic on overflow rather than wrap silently.
/// Used by feat/policy-lifecycle.
#[allow(dead_code)]
pub fn next_policy_id(env: &Env, holder: &Address) -> u32 {
    let key = DataKey::PolicyCounter(holder.clone());
    let current: u32 = env.storage().persistent().get(&key).unwrap_or(0);
    let next = current
        .checked_add(1)
        .unwrap_or_else(|| panic!("policy_id overflow"));
    env.storage().persistent().set(&key, &next);
    next
}

/// Returns the next global claim_id and increments the counter.
/// Uses checked_add to panic on overflow rather than wrap silently.
/// Used by feat/claim-voting.
#[allow(dead_code)]
pub fn next_claim_id(env: &Env) -> u64 {
    let current: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ClaimCounter)
        .unwrap_or(0u64);
    let next = current
        .checked_add(1)
        .unwrap_or_else(|| panic!("claim_id overflow"));
    env.storage().instance().set(&DataKey::ClaimCounter, &next);
    next
}
