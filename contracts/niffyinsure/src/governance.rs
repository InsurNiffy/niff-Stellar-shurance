use soroban_sdk::{contractevent, contracterror, contracttype, panic_with_error, Address, Env, String};

use crate::{events::EVENT_SCHEMA_VERSION, ledger, storage, validate};

pub const MINIMUM_STAKE_POLICIES: u32 = 1;

/// Hard maximum for the per-proposer proposal cooldown to prevent accidental lock-out.
pub const MAX_PROPOSER_COOLDOWN_LEDGERS: u32 = 7 * crate::ledger::LEDGERS_PER_DAY; // ~7 days

// ── Governance events ──────────────────────────────────────────────────────────

/// Emitted by `create_proposal`.
/// topics: ("niffyinsure", "proposal_created", proposal_id, creator)
#[contractevent(topics = ["niffyinsure", "proposal_created"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalCreated {
    #[topic]
    pub proposal_id: u64,
    #[topic]
    pub creator: Address,
    pub version: u32,
    pub param_key: String,
    pub proposed_value: u32,
    pub deadline: u32,
    pub at_ledger: u32,
}

/// Emitted by `vote_proposal` on each ballot cast.
/// topics: ("niffyinsure", "proposal_vote_cast", proposal_id, voter)
#[contractevent(topics = ["niffyinsure", "proposal_vote_cast"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalVoteCast {
    #[topic]
    pub proposal_id: u64,
    #[topic]
    pub voter: Address,
    pub version: u32,
    pub approve: bool,
    pub approve_votes: u32,
    pub reject_votes: u32,
    pub at_ledger: u32,
}

/// Emitted by `vote_proposal` when a proposal reaches quorum and is applied or rejected.
/// topics: ("niffyinsure", "proposal_resolved", proposal_id)
#[contractevent(topics = ["niffyinsure", "proposal_resolved"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalResolved {
    #[topic]
    pub proposal_id: u64,
    pub version: u32,
    pub param_key: String,
    pub proposed_value: u32,
    /// `true` = proposal passed and was applied; `false` = rejected.
    pub applied: bool,
    pub at_ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum GovernanceError {
    NotTokenHolder = 300,
    ProposalNotFound = 301,
    DuplicateVote = 302,
    VotingClosed = 303,
    UnsupportedParameter = 304,
    InvalidParameterValue = 305,
    /// Per-proposer cooldown is still active; too soon since last proposal.
    ProposerCooldownActive = 306,
    /// Proposer cooldown value is out of the allowed bounds.
    ProposerCooldownOutOfBounds = 307,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub proposal_id: u64,
    pub creator: Address,
    pub param_key: String,
    pub proposed_value: u32,
    pub deadline: u32,
    pub approve_votes: u32,
    pub reject_votes: u32,
    pub applied: bool,
}

fn require_token_holder(env: &Env, holder: &Address) {
    holder.require_auth();
    if storage::get_holder_active_policy_count(env, holder) < MINIMUM_STAKE_POLICIES {
        panic_with_error!(env, GovernanceError::NotTokenHolder);
    }
}

fn quorum_required(env: &Env) -> u32 {
    let eligible = storage::get_voters(env).len();
    if eligible == 0 {
        return 1;
    }
    (eligible / 2).saturating_add(1)
}

fn validate_supported_parameter(env: &Env, param_key: &String, new_value: u32) {
    if *param_key == String::from_str(env, "quorum_bps") {
        if validate::validate_quorum_bps(new_value).is_err() {
            panic_with_error!(env, GovernanceError::InvalidParameterValue);
        }
        return;
    }

    if *param_key == String::from_str(env, "voting_duration_ledgers") {
        if ledger::validate_voting_duration_ledgers(new_value).is_err() {
            panic_with_error!(env, GovernanceError::InvalidParameterValue);
        }
        return;
    }

    panic_with_error!(env, GovernanceError::UnsupportedParameter);
}

fn apply_parameter(env: &Env, proposal: &Proposal) {
    if proposal.param_key == String::from_str(env, "quorum_bps") {
        storage::set_quorum_bps(env, proposal.proposed_value);
        return;
    }

    if proposal.param_key == String::from_str(env, "voting_duration_ledgers") {
        storage::set_voting_duration_ledgers(env, proposal.proposed_value);
    }
}

pub fn create_proposal(env: &Env, creator: Address, param_key: String, new_value: u32) -> u64 {
    require_token_holder(env, &creator);
    validate_supported_parameter(env, &param_key, new_value);

    // Per-proposer cooldown: reject if last proposal was too recent.
    let now = env.ledger().sequence();
    let proposer_cooldown = storage::get_proposer_cooldown_ledgers(env);
    if proposer_cooldown > 0 {
        if let Some(last) = storage::get_last_proposal_ledger(env, &creator) {
            if now.saturating_sub(last) < proposer_cooldown {
                panic_with_error!(env, GovernanceError::ProposerCooldownActive);
            }
        }
    }
    storage::set_last_proposal_ledger(env, &creator, now);

    let proposal_id = storage::next_proposal_id(env);
    let deadline = now
        .checked_add(storage::get_voting_duration_ledgers(env))
        .unwrap_or_else(|| panic_with_error!(env, GovernanceError::InvalidParameterValue));
    let proposal = Proposal {
        proposal_id,
        creator: creator.clone(),
        param_key: param_key.clone(),
        proposed_value: new_value,
        deadline,
        approve_votes: 0,
        reject_votes: 0,
        applied: false,
    };
    storage::set_proposal(env, &proposal);

    ProposalCreated {
        proposal_id,
        creator,
        version: EVENT_SCHEMA_VERSION,
        param_key,
        proposed_value: new_value,
        deadline,
        at_ledger: now,
    }
    .publish(env);

    proposal_id
}

pub fn vote_proposal(
    env: &Env,
    voter: Address,
    proposal_id: u64,
    approve: bool,
) -> Result<(), GovernanceError> {
    require_token_holder(env, &voter);

    let mut proposal =
        storage::get_proposal(env, proposal_id).ok_or(GovernanceError::ProposalNotFound)?;
    if env.ledger().sequence() > proposal.deadline {
        storage::remove_proposal(env, proposal_id);
        return Err(GovernanceError::VotingClosed);
    }
    if storage::has_proposal_vote(env, proposal_id, &voter) {
        return Err(GovernanceError::DuplicateVote);
    }

    storage::set_proposal_vote(env, proposal_id, &voter, approve);
    if approve {
        proposal.approve_votes = proposal.approve_votes.saturating_add(1);
    } else {
        proposal.reject_votes = proposal.reject_votes.saturating_add(1);
    }

    ProposalVoteCast {
        proposal_id,
        voter: voter.clone(),
        version: EVENT_SCHEMA_VERSION,
        approve,
        approve_votes: proposal.approve_votes,
        reject_votes: proposal.reject_votes,
        at_ledger: env.ledger().sequence(),
    }
    .publish(env);

    let quorum = quorum_required(env);
    if proposal.approve_votes >= quorum {
        apply_parameter(env, &proposal);
        proposal.applied = true;
        storage::set_proposal(env, &proposal);
        ProposalResolved {
            proposal_id,
            version: EVENT_SCHEMA_VERSION,
            param_key: proposal.param_key.clone(),
            proposed_value: proposal.proposed_value,
            applied: true,
            at_ledger: env.ledger().sequence(),
        }
        .publish(env);
        return Ok(());
    }

    if proposal.reject_votes >= quorum {
        ProposalResolved {
            proposal_id,
            version: EVENT_SCHEMA_VERSION,
            param_key: proposal.param_key.clone(),
            proposed_value: proposal.proposed_value,
            applied: false,
            at_ledger: env.ledger().sequence(),
        }
        .publish(env);
        storage::remove_proposal(env, proposal_id);
        return Ok(());
    }

    storage::set_proposal(env, &proposal);
    Ok(())
}

pub fn get_proposal(env: &Env, proposal_id: u64) -> Option<Proposal> {
    storage::get_proposal(env, proposal_id)
}

pub fn get_governance_cooldown_ledgers(env: &Env) -> u32 {
    storage::get_governance_cooldown_ledgers(env)
}

/// Admin-only: set per-proposer cooldown window (ledgers between proposals from same address).
/// 0 disables the per-proposer cooldown. Bounded by `MAX_PROPOSER_COOLDOWN_LEDGERS`.
pub fn admin_set_proposer_cooldown_ledgers(
    env: &Env,
    new_ledgers: u32,
) -> Result<(), GovernanceError> {
    if new_ledgers > MAX_PROPOSER_COOLDOWN_LEDGERS {
        return Err(GovernanceError::ProposerCooldownOutOfBounds);
    }
    storage::set_proposer_cooldown_ledgers(env, new_ledgers);
    Ok(())
}

pub fn get_proposer_cooldown_ledgers(env: &Env) -> u32 {
    storage::get_proposer_cooldown_ledgers(env)
}
