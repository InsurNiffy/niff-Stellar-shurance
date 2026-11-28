use soroban_sdk::{contracttype, Address, Env, Vec};

/// Lifecycle status of a claim.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ClaimStatus {
    Pending = 0,
    Approved = 1,
    Rejected = 2,
    Finalized = 3,
}

/// A single claim record.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claim {
    pub id: u64,
    pub holder: Address,
    pub status: ClaimStatus,
    pub created_at: u32,
    pub updated_at: u32,
}

/// Aggregated vote tally for a claim.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimVoteTally {
    pub approve_votes: u32,
    pub reject_votes: u32,
    pub eligible_voter_count: u32,
    pub quorum_bps: u32,
}

/// Maximum number of status history entries returned by `get_claim_history`.
pub const MAX_HISTORY_LEN: u32 = 32;

fn claim_key(id: u64) -> (u32, u64) {
    (0u32, id)
}

fn history_key(id: u64) -> (u32, u64) {
    (1u32, id)
}

fn tally_key(id: u64) -> (u32, u64) {
    (2u32, id)
}

fn holder_index_key(holder: &Address, id: u64) -> (u32, Address, u64) {
    (3u32, holder.clone(), id)
}

/// Persist a claim record.
pub fn put_claim(env: &Env, claim: &Claim) {
    env.storage().persistent().set(&claim_key(claim.id), claim);
    env.storage()
        .persistent()
        .set(&holder_index_key(&claim.holder, claim.id), &claim.id);
}

/// Read a claim by ID. Returns `None` for missing IDs without reverting.
pub fn get_claim(env: &Env, id: u64) -> Option<Claim> {
    env.storage().persistent().get(&claim_key(id))
}

/// Append a status transition to the bounded history for a claim.
pub fn push_claim_history(env: &Env, id: u64, status: ClaimStatus, at: u32) {
    let key = history_key(id);
    let mut history: Vec<(ClaimStatus, u32)> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    history.push_back((status, at));
    while history.len() > MAX_HISTORY_LEN {
        history.pop_front();
    }
    env.storage().persistent().set(&key, &history);
}

/// Return the bounded status history for a claim as `(ClaimStatus, u32)` pairs.
pub fn get_claim_history(env: &Env, id: u64) -> Vec<(ClaimStatus, u32)> {
    env.storage()
        .persistent()
        .get(&history_key(id))
        .unwrap_or_else(|| Vec::new(env))
}

/// Persist the vote tally for a claim.
pub fn put_claim_vote_tally(env: &Env, id: u64, tally: &ClaimVoteTally) {
    env.storage().persistent().set(&tally_key(id), tally);
}

/// Return the vote tally for a claim, defaulting to zeroed values when unset.
pub fn get_claim_vote_tally(env: &Env, id: u64) -> ClaimVoteTally {
    env.storage()
        .persistent()
        .get(&tally_key(id))
        .unwrap_or(ClaimVoteTally {
            approve_votes: 0,
            reject_votes: 0,
            eligible_voter_count: 0,
            quorum_bps: 0,
        })
}

/// Return the current status of a claim, or `None` when the claim is missing.
pub fn get_claim_status(env: &Env, id: u64) -> Option<ClaimStatus> {
    get_claim(env, id).map(|claim| claim.status)
}

/// Whether a claim has reached a terminal (finalized) status.
pub fn is_claim_finalized(env: &Env, id: u64) -> bool {
    matches!(get_claim_status(env, id), Some(ClaimStatus::Finalized))
}

/// List claim IDs for a holder with gap-free pagination.
///
/// `start_after` is exclusive: pass `None` to start from the beginning, or the
/// last ID from the previous page to continue. `limit` caps the page size.
pub fn list_claims(
    env: &Env,
    holder: Address,
    start_after: Option<u64>,
    limit: u32,
) -> Vec<u64> {
    let mut out: Vec<u64> = Vec::new(env);
    if limit == 0 {
        return out;
    }

    let mut cursor = start_after;
    loop {
        let next = match cursor {
            Some(prev) => env
                .storage()
                .persistent()
                .get::<(u32, Address, u64), u64>(&holder_index_key(&holder, prev + 1)),
            None => env
                .storage()
                .persistent()
                .get::<(u32, Address, u64), u64>(&holder_index_key(&holder, 0)),
        };

        match next {
            Some(id) => {
                out.push_back(id);
                if out.len() >= limit {
                    break;
                }
                cursor = Some(id);
            }
            None => break,
        }
    }

    out
}
