use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::types::{Claim, ClaimStatus, Config, Policy, PolicyStatus, Vote};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Config,
    ClaimCount,
    Claim(u64),
    PolicyCount,
    Policy(u64),
    Vote(u64, Address),
    // Voter registry (bucketed layout)
    VoterBucketCount,
    VoterBucket(u32),
    VoterIndex(Address),
    MaxVotersPerClaim,
}

/// Number of voter addresses stored per bucket. Keeps any single ledger entry
/// bounded so the registry can grow without hitting entry-size limits.
pub const VOTER_BUCKET_SIZE: u32 = 50;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

pub fn get_config(env: &Env) -> Config {
    env.storage().instance().get(&DataKey::Config).unwrap()
}

pub fn set_config(env: &Env, config: &Config) {
    env.storage().instance().set(&DataKey::Config, config);
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

pub fn next_claim_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ClaimCount)
        .unwrap_or(0);
    env.storage().instance().set(&DataKey::ClaimCount, &(id + 1));
    id
}

pub fn get_claim(env: &Env, id: u64) -> Option<Claim> {
    env.storage().persistent().get(&DataKey::Claim(id))
}

pub fn set_claim(env: &Env, id: u64, claim: &Claim) {
    env.storage().persistent().set(&DataKey::Claim(id), claim);
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

pub fn next_policy_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::PolicyCount)
        .unwrap_or(0);
    env.storage().instance().set(&DataKey::PolicyCount, &(id + 1));
    id
}

pub fn get_policy(env: &Env, id: u64) -> Option<Policy> {
    env.storage().persistent().get(&DataKey::Policy(id))
}

pub fn set_policy(env: &Env, id: u64, policy: &Policy) {
    env.storage().persistent().set(&DataKey::Policy(id), policy);
}

// ---------------------------------------------------------------------------
// Votes
// ---------------------------------------------------------------------------

pub fn get_vote(env: &Env, claim_id: u64, voter: &Address) -> Option<Vote> {
    env.storage()
        .persistent()
        .get(&DataKey::Vote(claim_id, voter.clone()))
}

pub fn set_vote(env: &Env, claim_id: u64, voter: &Address, vote: &Vote) {
    env.storage()
        .persistent()
        .set(&DataKey::Vote(claim_id, voter.clone()), vote);
}

// ---------------------------------------------------------------------------
// Voter registry — bucketed layout
// ---------------------------------------------------------------------------

pub fn get_max_voters_per_claim(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MaxVotersPerClaim)
        .unwrap_or(0)
}

pub fn set_max_voters_per_claim(env: &Env, max: u32) {
    env.storage()
        .instance()
        .set(&DataKey::MaxVotersPerClaim, &max);
}

fn bucket_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::VoterBucketCount)
        .unwrap_or(0)
}

fn get_bucket(env: &Env, index: u32) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::VoterBucket(index))
        .unwrap_or_else(|| Vec::new(env))
}

fn set_bucket(env: &Env, index: u32, bucket: &Vec<Address>) {
    env.storage()
        .persistent()
        .set(&DataKey::VoterBucket(index), bucket);
}

/// Returns the (bucket index, position within bucket) for a registered voter.
pub fn voter_index(env: &Env, voter: &Address) -> Option<(u32, u32)> {
    env.storage()
        .persistent()
        .get(&DataKey::VoterIndex(voter.clone()))
}

pub fn voter_registry_contains(env: &Env, voter: &Address) -> bool {
    voter_index(env, voter).is_some()
}

pub fn voter_registry_len(env: &Env) -> u32 {
    let count = bucket_count(env);
    if count == 0 {
        return 0;
    }
    let last = count - 1;
    (last * VOTER_BUCKET_SIZE) + get_bucket(env, last).len()
}

/// Adds a voter to the registry. Returns `true` if newly added, `false` if the
/// voter was already present (dedupe). Caller is responsible for cap checks.
pub fn add_voter(env: &Env, voter: &Address) -> bool {
    if voter_registry_contains(env, voter) {
        return false;
    }

    let count = bucket_count(env);
    if count == 0 {
        env.storage()
            .instance()
            .set(&DataKey::VoterBucketCount, &1u32);
        let mut bucket = Vec::new(env);
        bucket.push_back(voter.clone());
        set_bucket(env, 0, &bucket);
        env.storage()
            .persistent()
            .set(&DataKey::VoterIndex(voter.clone()), &(0u32, 0u32));
        return true;
    }

    let last = count - 1;
    let mut bucket = get_bucket(env, last);
    let pos = bucket.len();
    if pos >= VOTER_BUCKET_SIZE {
        let new_index = count;
        env.storage()
            .instance()
            .set(&DataKey::VoterBucketCount, &(count + 1));
        let mut new_bucket = Vec::new(env);
        new_bucket.push_back(voter.clone());
        set_bucket(env, new_index, &new_bucket);
        env.storage()
            .persistent()
            .set(&DataKey::VoterIndex(voter.clone()), &(new_index, 0u32));
        return true;
    }

    bucket.push_back(voter.clone());
    set_bucket(env, last, &bucket);
    env.storage()
        .persistent()
        .set(&DataKey::VoterIndex(voter.clone()), &(last, pos));
    true
}

/// Removes a voter from the registry. Idempotent: returns `true` if removed,
/// `false` if the voter was not present. Uses swap-remove within the bucket.
pub fn remove_voter(env: &Env, voter: &Address) -> bool {
    let (bucket_index, pos) = match voter_index(env, voter) {
        Some(loc) => loc,
        None => return false,
    };

    let mut bucket = get_bucket(env, bucket_index);
    let last_pos = bucket.len() - 1;

    if pos != last_pos {
        let moved = bucket.get_unchecked(last_pos);
        bucket.set(pos, moved.clone());
        env.storage()
            .persistent()
            .set(&DataKey::VoterIndex(moved), &(bucket_index, pos));
    }
    bucket.pop_back();
    set_bucket(env, bucket_index, &bucket);
    env.storage()
        .persistent()
        .remove(&DataKey::VoterIndex(voter.clone()));

    // Drop trailing empty buckets to keep the layout compact.
    let count = bucket_count(env);
    if bucket.is_empty() && count > 0 && bucket_index == count - 1 {
        env.storage()
            .instance()
            .set(&DataKey::VoterBucketCount, &(count - 1));
    }

    true
}

/// Returns up to `limit` voters starting at `offset`, walking buckets.
pub fn get_voters(env: &Env, offset: u32, limit: u32) -> Vec<Address> {
    let mut result = Vec::new(env);
    if limit == 0 {
        return result;
    }

    let count = bucket_count(env);
    let mut skipped = 0u32;
    let mut collected = 0u32;

    let mut i = 0u32;
    while i < count && collected < limit {
        let bucket = get_bucket(env, i);
        let mut j = 0u32;
        while j < bucket.len() && collected < limit {
            if skipped < offset {
                skipped += 1;
            } else {
                result.push_back(bucket.get_unchecked(j));
                collected += 1;
            }
            j += 1;
        }
        i += 1;
    }

    result
}

// ---------------------------------------------------------------------------
// Eligibility helpers
// ---------------------------------------------------------------------------

/// Returns true if the holder currently has at least one active policy.
pub fn holder_has_active_policy(env: &Env, holder: &Address) -> bool {
    let count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::PolicyCount)
        .unwrap_or(0);
    let mut i = 0u64;
    while i < count {
        if let Some(policy) = get_policy(env, i) {
            if policy.holder == *holder && policy.status == PolicyStatus::Active {
                return true;
            }
        }
        i += 1;
    }
    false
}

/// Reconciles registry membership with the holder's active-policy state.
/// Auto-adds on first active policy, auto-removes when none remain.
/// Returns `Some(true)` if added, `Some(false)` if removed, `None` if unchanged.
pub fn sync_voter_eligibility(env: &Env, holder: &Address) -> Option<bool> {
    let eligible = holder_has_active_policy(env, holder);
    let present = voter_registry_contains(env, holder);

    if eligible && !present {
        add_voter(env, holder);
        Some(true)
    } else if !eligible && present {
        remove_voter(env, holder);
        Some(false)
    } else {
        None
    }
}

// Silence unused import warnings for types referenced only in signatures.
#[allow(dead_code)]
fn _assert_types(_c: Claim, _s: ClaimStatus) {}
