//! Commit-reveal voting scheme for claim DAO votes.
//!
//! # Protocol
//!
//! 1. **Commit phase** (`commit_phase_end_ledger`): voters submit
//!    `commitment = SHA-256(vote_byte || salt)` without revealing their vote.
//! 2. **Reveal phase** (`reveal_phase_end_ledger`): voters reveal `(vote, salt)`;
//!    the contract re-hashes and checks against the stored commitment.
//!    A successful reveal records a `Vote` and increments the claim tally.
//!
//! # Unrevealed commits (timeout behaviour)
//!
//! If a voter commits but **never reveals** before `reveal_phase_end_ledger`:
//!
//! - The commitment remains in storage but is **ignored** at finalization.
//! - It does **not** count as Approve or Reject (treated as an **abstention**).
//! - There is **no slash / penalty** for failing to reveal.
//! - Tallies only include votes written during a successful `reveal_vote`
//!   (which updates `claim.approve_votes` / `claim.reject_votes`).
//!
//! After the reveal window closes, further reveals revert with `RevealPhaseEnded`.
//! Finalization (`finalize_claim`) uses the claim counters above and therefore
//! correctly excludes unrevealed commits from the outcome.
//!
//! # Storage keys (persistent)
//!
//! - `CommitRevealPhases(claim_id)` — phase ledger boundaries.
//! - `VoteCommitment(claim_id, voter)` — 32-byte commitment hash.
//! - `Vote(claim_id, voter)` — revealed ballot (same key as open voting).
//!
//! # Error codes
//!
//! New variants are appended to `validate::Error`; see that module for the
//! full list.

use soroban_sdk::{Address, BytesN, Env};

use crate::{events::EVENT_SCHEMA_VERSION, storage, validate::Error};

// ── Events ────────────────────────────────────────────────────────────────────

/// Emitted by `commit_vote`. Does NOT include the vote or salt.
/// topics: ("niffyinsure", "vote_committed", claim_id, voter)
#[contractevent(topics = ["niffyinsure", "vote_committed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteCommitted {
    #[topic]
    pub claim_id: u64,
    #[topic]
    pub voter: Address,
    pub version: u32,
    pub at_ledger: u32,
}

/// Emitted by `reveal_vote` on a successful reveal.
/// topics: ("niffyinsure", "vote_revealed", claim_id, voter)
#[contractevent(topics = ["niffyinsure", "vote_revealed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteRevealed {
    #[topic]
    pub claim_id: u64,
    #[topic]
    pub voter: Address,
    pub version: u32,
    pub vote: crate::types::VoteOption,
    pub approve_votes: u32,
    pub reject_votes: u32,
    pub at_ledger: u32,
}

pub use crate::types::CommitRevealPhases;

// ── Phase helpers ─────────────────────────────────────────────────────────────

pub fn set_phases(env: &Env, claim_id: u64, phases: &CommitRevealPhases) {
    storage::set_commit_reveal_phases(env, claim_id, phases);
}

pub fn get_phases(env: &Env, claim_id: u64) -> Option<CommitRevealPhases> {
    storage::get_commit_reveal_phases(env, claim_id)
}

/// `true` when the voter has a stored commitment for `claim_id`.
pub fn has_commitment(env: &Env, claim_id: u64, voter: &Address) -> bool {
    storage::has_vote_commitment(env, claim_id, voter)
}

/// `true` when the voter successfully revealed (a `Vote` entry exists).
pub fn is_vote_revealed(env: &Env, claim_id: u64, voter: &Address) -> bool {
    storage::get_vote(env, claim_id, voter).is_some()
}

/// `true` when the voter committed but never revealed (abstention after timeout).
pub fn is_unrevealed_commit(env: &Env, claim_id: u64, voter: &Address) -> bool {
    has_commitment(env, claim_id, voter) && !is_vote_revealed(env, claim_id, voter)
}

// ── Commit ────────────────────────────────────────────────────────────────────

/// Store a voter's commitment during the commit phase.
///
/// # Errors
/// - `CommitPhaseEnded`   — current ledger > `commit_phase_end_ledger`.
/// - `DuplicateVote`      — voter already committed for this claim.
/// - `CommitRevealNotSet` — no phases configured for this claim.
pub fn commit_vote(
    env: &Env,
    voter: &Address,
    claim_id: u64,
    commitment: BytesN<32>,
) -> Result<(), Error> {
    voter.require_auth();

    let phases = get_phases(env, claim_id).ok_or(Error::CommitRevealNotSet)?;
    let now = env.ledger().sequence();

    if now > phases.commit_phase_end_ledger {
        return Err(Error::CommitPhaseEnded);
    }

    if storage::has_vote_commitment(env, claim_id, voter) {
        return Err(Error::DuplicateVote);
    }

    storage::set_vote_commitment(env, claim_id, voter, &commitment);

    VoteCommitted {
        claim_id,
        voter: voter.clone(),
        version: EVENT_SCHEMA_VERSION,
        at_ledger: env.ledger().sequence(),
    }
    .publish(env);

    Ok(())
}

// ── Reveal ────────────────────────────────────────────────────────────────────

/// Verify a voter's reveal and record their vote during the reveal phase.
///
/// The commitment must equal `SHA-256(vote_byte || salt)` where `vote_byte`
/// is `0x00` for `Approve` and `0x01` for `Reject`.
///
/// On success the revealed ballot is stored under `Vote` and the claim's
/// `approve_votes` / `reject_votes` counters are incremented (weight 1).
/// Unrevealed commits never reach this path and therefore never affect tallies.
///
/// # Errors
/// - `CommitRevealNotSet`  — no phases configured for this claim.
/// - `RevealPhaseNotOpen`  — current ledger <= `commit_phase_end_ledger`.
/// - `RevealPhaseEnded`    — current ledger > `reveal_phase_end_ledger`.
/// - `CommitmentNotFound`  — voter never committed.
/// - `CommitmentMismatch`  — recomputed hash does not match stored commitment.
/// - `DuplicateVote`       — voter already revealed (Vote key exists).
/// - `ClaimNotFound`       — claim record missing when applying tally.
pub fn reveal_vote(
    env: &Env,
    voter: &Address,
    claim_id: u64,
    vote: crate::types::VoteOption,
    salt: BytesN<32>,
) -> Result<(), Error> {
    voter.require_auth();

    let phases = get_phases(env, claim_id).ok_or(Error::CommitRevealNotSet)?;
    let now = env.ledger().sequence();

    if now <= phases.commit_phase_end_ledger {
        return Err(Error::RevealPhaseNotOpen);
    }
    if now > phases.reveal_phase_end_ledger {
        return Err(Error::RevealPhaseEnded);
    }

    let stored: BytesN<32> = storage::get_vote_commitment(env, claim_id, voter)
        .ok_or(Error::CommitmentNotFound)?;

    if storage::has_vote(env, claim_id, voter) {
        return Err(Error::DuplicateVote);
    }

    let vote_byte: u8 = match vote {
        crate::types::VoteOption::Approve => 0x00,
        crate::types::VoteOption::Reject => 0x01,
    };

    // Hash preimage: vote_byte || salt || voter_bytes
    // Voter is included so commitments cannot be copied between voters.
    let mut preimage = soroban_sdk::Bytes::new(env);
    preimage.push_back(vote_byte);
    let salt_bytes: soroban_sdk::Bytes = salt.into();
    preimage.append(&salt_bytes);
    let voter_bytes = voter.to_xdr(env);
    preimage.append(&voter_bytes);

    let computed: BytesN<32> = env.crypto().sha256(&preimage).into();

    if computed != stored {
        return Err(Error::CommitmentMismatch);
    }

    storage::set_vote(env, claim_id, voter, &vote);

    // Apply to claim tallies — only revealed ballots are counted.
    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;
    match vote {
        crate::types::VoteOption::Approve => {
            claim.approve_votes = claim.approve_votes.saturating_add(1);
        }
        crate::types::VoteOption::Reject => {
            claim.reject_votes = claim.reject_votes.saturating_add(1);
        }
    }
    storage::set_claim(env, &claim);

    VoteRevealed {
        claim_id,
        voter: voter.clone(),
        version: EVENT_SCHEMA_VERSION,
        vote,
        approve_votes: claim.approve_votes,
        reject_votes: claim.reject_votes,
        at_ledger: env.ledger().sequence(),
    }
    .publish(env);

    Ok(())
}
