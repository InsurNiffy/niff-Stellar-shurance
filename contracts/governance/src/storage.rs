use soroban_sdk::{contracttype, Address, BytesN, Env};

/// Scope of a delegation: either global or limited to a specific claim.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DelegationScope {
    Global,
    Claim(u64),
}

/// Storage keys for the governance contract.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Admin address.
    Admin,
    /// Ledger at which the commit phase ends and reveal phase begins.
    RevealDeadlineLedger,
    /// Per-voter commitment for a claim: hash(vote || salt).
    Commitment(Address, u64),
    /// Accumulated tally for a claim (only updated during reveal).
    Tally(u64),
    /// Delegatee for a delegator's global delegation.
    GlobalDelegate(Address),
    /// Delegatee for a delegator's per-claim delegation.
    ClaimDelegate(Address, u64),
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_reveal_deadline_ledger(env: &Env, ledger: u32) {
    env.storage()
        .instance()
        .set(&DataKey::RevealDeadlineLedger, &ledger);
}

pub fn get_reveal_deadline_ledger(env: &Env) -> Option<u32> {
    env.storage().instance().get(&DataKey::RevealDeadlineLedger)
}

pub fn set_commitment(env: &Env, voter: &Address, claim_id: u64, commitment: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::Commitment(voter.clone(), claim_id), commitment);
}

pub fn get_commitment(env: &Env, voter: &Address, claim_id: u64) -> Option<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&DataKey::Commitment(voter.clone(), claim_id))
}

pub fn remove_commitment(env: &Env, voter: &Address, claim_id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::Commitment(voter.clone(), claim_id));
}

pub fn get_tally(env: &Env, claim_id: u64) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Tally(claim_id))
        .unwrap_or(0)
}

pub fn set_tally(env: &Env, claim_id: u64, tally: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::Tally(claim_id), &tally);
}

pub fn set_delegation(env: &Env, delegator: &Address, scope: &DelegationScope, delegatee: &Address) {
    match scope {
        DelegationScope::Global => env
            .storage()
            .persistent()
            .set(&DataKey::GlobalDelegate(delegator.clone()), delegatee),
        DelegationScope::Claim(claim_id) => env
            .storage()
            .persistent()
            .set(&DataKey::ClaimDelegate(delegator.clone(), *claim_id), delegatee),
    }
}

pub fn get_delegation(env: &Env, delegator: &Address, scope: &DelegationScope) -> Option<Address> {
    match scope {
        DelegationScope::Global => env
            .storage()
            .persistent()
            .get(&DataKey::GlobalDelegate(delegator.clone())),
        DelegationScope::Claim(claim_id) => env
            .storage()
            .persistent()
            .get(&DataKey::ClaimDelegate(delegator.clone(), *claim_id)),
    }
}

pub fn remove_delegation(env: &Env, delegator: &Address, scope: &DelegationScope) {
    match scope {
        DelegationScope::Global => env
            .storage()
            .persistent()
            .remove(&DataKey::GlobalDelegate(delegator.clone())),
        DelegationScope::Claim(claim_id) => env
            .storage()
            .persistent()
            .remove(&DataKey::ClaimDelegate(delegator.clone(), *claim_id)),
    }
}
