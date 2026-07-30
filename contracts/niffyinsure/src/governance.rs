use soroban_sdk::{contracterror, contracttype, panic_with_error, Address, Env, String};

use crate::{ledger, storage, validate};

pub const MINIMUM_STAKE_POLICIES: u32 = 1;

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

    let proposal_id = storage::next_proposal_id(env);
    let proposal = Proposal {
        proposal_id,
        creator,
        param_key,
        proposed_value: new_value,
        deadline: env
            .ledger()
            .sequence()
            .checked_add(storage::get_voting_duration_ledgers(env))
            .unwrap_or_else(|| panic_with_error!(env, GovernanceError::InvalidParameterValue)),
        approve_votes: 0,
        reject_votes: 0,
        applied: false,
    };
    storage::set_proposal(env, &proposal);
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

    let quorum = quorum_required(env);
    if proposal.approve_votes >= quorum {
        apply_parameter(env, &proposal);
        proposal.applied = true;
        storage::set_proposal(env, &proposal);
        return Ok(());
    }

    if proposal.reject_votes >= quorum {
        storage::remove_proposal(env, proposal_id);
        return Ok(());
    }

    storage::set_proposal(env, &proposal);
    Ok(())
}

pub fn get_proposal(env: &Env, proposal_id: u64) -> Option<Proposal> {
    storage::get_proposal(env, proposal_id)
}
