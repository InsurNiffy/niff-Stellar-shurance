use soroban_sdk::{contracterror, contracttype, symbol_short, Address, Env, Symbol, Vec};

use crate::storage::{self, ClaimStatus, VoteOption};

const VOTE_CAST: Symbol = symbol_short!("VoteCast");

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VotingError {
    ClaimNotFound = 1,
    NotVotable = 2,
    NotInSnapshot = 3,
    ZeroVotingPower = 4,
    ClaimantCannotVote = 5,
    AlreadyVoted = 6,
    SnapshotExpired = 7,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteCastEvent {
    pub voter: Address,
    pub claim_id: u64,
    pub vote: VoteOption,
    pub approve_tally: i128,
    pub reject_tally: i128,
}

/// Submit a vote on a claim.
///
/// Validates eligibility against the filing-time snapshot, ensures the claim is
/// still votable, guards against an expired snapshot TTL, records the vote, and
/// triggers early plurality resolution when quorum is met.
pub fn vote_on_claim(
    env: &Env,
    voter: Address,
    claim_id: u64,
    vote: VoteOption,
) -> Result<(), VotingError> {
    voter.require_auth();

    let mut claim = storage::get_claim(env, claim_id).ok_or(VotingError::ClaimNotFound)?;

    if claim.status != ClaimStatus::Voting {
        return Err(VotingError::NotVotable);
    }

    // Snapshot TTL guard: reject votes once the snapshot window has elapsed.
    let now = env.ledger().timestamp();
    if now > claim.snapshot_expires_at {
        return Err(VotingError::SnapshotExpired);
    }

    // Eligibility against the filing-time snapshot.
    let power = storage::get_snapshot_power(env, claim_id, &voter)
        .ok_or(VotingError::NotInSnapshot)?;
    if power <= 0 {
        return Err(VotingError::ZeroVotingPower);
    }
    if voter == claim.claimant {
        return Err(VotingError::ClaimantCannotVote);
    }

    // Reject duplicate votes.
    if storage::has_voted(env, claim_id, &voter) {
        return Err(VotingError::AlreadyVoted);
    }

    // Record the vote and update the tally atomically.
    storage::set_has_voted(env, claim_id, &voter);
    match vote {
        VoteOption::Approve => claim.approve_tally += power,
        VoteOption::Reject => claim.reject_tally += power,
    }
    storage::set_claim(env, claim_id, &claim);

    env.events().publish(
        (VOTE_CAST, claim_id),
        VoteCastEvent {
            voter: voter.clone(),
            claim_id,
            vote,
            approve_tally: claim.approve_tally,
            reject_tally: claim.reject_tally,
        },
    );

    // Attempt early resolution if quorum is now met.
    crate::resolution::resolve_plurality_if_quorum_met(env, claim_id)?;

    Ok(())
}
