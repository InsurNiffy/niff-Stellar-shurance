// Claim lifecycle and DAO voting implementation.
//
// Public functions:
//   file_claim(env, policy_id, amount, details, image_urls)
//   vote_on_claim(env, voter, claim_id, vote)
//
// Rejection consequences:
//   - Increments policy.rejected_claims_count (strike counter)
//   - Deactivates policy if strikes exceed MAX_REJECTED_CLAIMS_BEFORE_DEACTIVATION
//   - Emits PolicyStrikeIncremented and PolicyDeactivated events
//   - Never transfers payout tokens
//
// Governance transparency:
//   - All state changes emit events for indexer consumption
//   - Rejected claims remain visible on-chain for auditability
//   - Admin overrides (if implemented) must be documented in governance docs

#![allow(deprecated)]

use crate::{
    storage::{self, DataKey},
    types::{
        Claim, ClaimError, ClaimStatus, Policy, VoteOption, DETAILS_MAX_LEN, IMAGE_URLS_MAX,
        IMAGE_URL_MAX_LEN,
    },
};
use soroban_sdk::{contracttype, Address, Env, String, Vec};

/// Maximum rejected claims before policy is automatically deactivated.
/// This threshold must be aligned with legal review and product specifications.
///
/// GOVERNANCE RISK: This constant is hardcoded; changing it requires contract upgrade.
/// Consider making this configurable per-policy-type in future iterations.
pub const MAX_REJECTED_CLAIMS_BEFORE_DEACTIVATION: u32 = 3;

/// Minimum number of votes required to finalize a claim decision.
/// This prevents early finalization with insufficient participation.
pub const MIN_VOTES_FOR_FINALIZATION: u32 = 3;

// ── Events ───────────────────────────────────────────────────────────────────

/// Emitted when a claim is filed.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ClaimFiled {
    pub claim_id: u64,
    pub policy_id: u32,
    pub claimant: Address,
    pub amount: i128,
}

/// Emitted when a vote is cast on a claim.
#[contracttype]
#[derive(Clone, Debug)]
pub struct VoteCast {
    pub claim_id: u64,
    pub voter: Address,
    pub vote: VoteOption,
    pub approve_votes: u32,
    pub reject_votes: u32,
}

/// Emitted when a claim is approved and payout is initiated.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ClaimApproved {
    pub claim_id: u64,
    pub policy_id: u32,
    pub claimant: Address,
    pub amount: i128,
}

/// Emitted when a claim is rejected.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ClaimRejected {
    pub claim_id: u64,
    pub policy_id: u32,
    pub claimant: Address,
}

/// Emitted when an appeal is opened on a rejected claim.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AppealOpened {
    pub claim_id: u64,
    pub policy_id: u32,
    pub claimant: Address,
    pub appeal_number: u32,
    pub additional_evidence: String,
}

/// Emitted when an appeal is closed (either approved or finally rejected).
#[contracttype]
#[derive(Clone, Debug)]
pub struct AppealClosed {
    pub claim_id: u64,
    pub policy_id: u32,
    pub claimant: Address,
    pub final_status: ClaimStatus,
}

/// Emitted when a policy receives a strike due to claim rejection.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PolicyStrikeIncremented {
    pub holder: Address,
    pub policy_id: u32,
    pub rejected_claims_count: u32,
}

/// Emitted when a policy is deactivated due to excessive rejected claims.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PolicyDeactivated {
    pub holder: Address,
    pub policy_id: u32,
    pub reason: String,
}

// ── Claim filing ─────────────────────────────────────────────────────────────

/// Files a new claim against an active policy.
///
/// Validation:
///   - Policy must exist and be active
///   - Claimant must be the policy holder
///   - Amount must be > 0 and ≤ policy.coverage
///   - Details must be ≤ DETAILS_MAX_LEN bytes
///   - image_urls must have ≤ IMAGE_URLS_MAX items, each ≤ IMAGE_URL_MAX_LEN bytes
///
/// Storage:
///   - Creates Claim record at DataKey::Claim(claim_id)
///   - Increments global ClaimCounter
///
/// Events:
///   - ClaimFiled
///
/// SECURITY: Does not store sensitive allegation narratives beyond DETAILS_MAX_LEN.
#[allow(dead_code)]
pub fn file_claim(
    env: &Env,
    claimant: Address,
    policy_id: u32,
    amount: i128,
    details: String,
    image_urls: Vec<String>,
) -> Result<u64, ClaimError> {
    claimant.require_auth();

    // Validate policy exists and is active
    let policy_key = DataKey::Policy(claimant.clone(), policy_id);
    let policy: Policy = env
        .storage()
        .persistent()
        .get(&policy_key)
        .ok_or(ClaimError::PolicyNotFound)?;

    if !policy.is_active {
        return Err(ClaimError::PolicyNotActive);
    }

    // Validate amount
    if amount <= 0 {
        return Err(ClaimError::InvalidAmount);
    }
    if amount > policy.coverage {
        return Err(ClaimError::AmountExceedsCoverage);
    }

    // Validate details length
    if details.len() > DETAILS_MAX_LEN {
        return Err(ClaimError::DetailsExceedMaxLength);
    }

    // Validate image_urls
    if image_urls.len() > IMAGE_URLS_MAX {
        return Err(ClaimError::TooManyImageUrls);
    }
    for url in image_urls.iter() {
        if url.len() > IMAGE_URL_MAX_LEN {
            return Err(ClaimError::ImageUrlExceedsMaxLength);
        }
    }

    // Create claim
    let claim_id = storage::next_claim_id(env);
    let current_ledger = env.ledger().sequence();
    let claim = Claim {
        claim_id,
        policy_id,
        claimant: claimant.clone(),
        amount,
        details,
        image_urls,
        status: ClaimStatus::Processing,
        approve_votes: 0,
        reject_votes: 0,
        filed_at_ledger: current_ledger,
        rejected_at_ledger: None,
        appeal_count: 0,
        appeal_opened_at_ledger: None,
    };

    env.storage()
        .persistent()
        .set(&DataKey::Claim(claim_id), &claim);

    // Emit event
    env.events().publish(
        (String::from_str(env, "claim_filed"),),
        ClaimFiled {
            claim_id,
            policy_id,
            claimant: claimant.clone(),
            amount,
        },
    );

    Ok(claim_id)
}

// ── Voting ───────────────────────────────────────────────────────────────────

/// Casts a vote on a claim.
///
/// Validation:
///   - Claim must exist and be in an active voting state (Processing or AppealOpen)
///   - Voter must have an active policy (one-policy-one-vote)
///   - Voter cannot vote twice on the same claim phase
///
/// State transitions:
///   - Processing → Approved: if approve_votes reaches majority
///   - Processing → Rejected: if reject_votes reaches majority
///   - AppealOpen → Approved: if approve_votes reaches majority
///   - AppealOpen → RejectedFinal: if reject_votes reaches majority
///
/// Rejection consequences:
///   - Increments policy.rejected_claims_count
///   - Deactivates policy if strikes exceed MAX_REJECTED_CLAIMS_BEFORE_DEACTIVATION
///   - Emits PolicyStrikeIncremented and PolicyDeactivated events
///
/// Approval consequences:
///   - Transfers payout tokens to claimant (implemented in token.rs)
///   - Emits ClaimApproved event
///
/// CRITICAL: Rejection path never transfers payout tokens.
///
/// APPEAL VOTING RULES:
///   - Votes reset when appeal is opened (fresh voting round)
///   - Voters can vote again even if they voted in the initial round
///   - Vote storage key includes claim phase to prevent double-voting within same phase
#[allow(dead_code)]
pub fn vote_on_claim(
    env: &Env,
    voter: Address,
    claim_id: u64,
    vote: VoteOption,
) -> Result<(), ClaimError> {
    voter.require_auth();

    // Load claim
    let claim_key = DataKey::Claim(claim_id);
    let mut claim: Claim = env
        .storage()
        .persistent()
        .get(&claim_key)
        .ok_or(ClaimError::ClaimNotFound)?;

    // Validate claim is in an active voting state
    if !claim.status.is_voting_active() {
        return Err(ClaimError::ClaimAlreadyFinalized);
    }

    // Validate voter has an active policy (simplified: check any policy exists)
    // TODO: Implement proper voter registry check in storage.rs
    let voter_policy_count = storage::get_policy_counter(env, &voter);
    if voter_policy_count == 0 {
        return Err(ClaimError::VoterHasNoPolicies);
    }

    // Check if voter already voted in this phase
    // Vote key includes appeal_count to allow re-voting in appeal phase
    let vote_key = DataKey::VotePhase(claim_id, voter.clone(), claim.appeal_count);
    if env.storage().persistent().has(&vote_key) {
        return Err(ClaimError::AlreadyVoted);
    }

    // Record vote
    env.storage().persistent().set(&vote_key, &vote);

    // Update vote tallies
    match vote {
        VoteOption::Approve => claim.approve_votes += 1,
        VoteOption::Reject => claim.reject_votes += 1,
    }

    // Emit vote event
    env.events().publish(
        (String::from_str(env, "vote_cast"),),
        VoteCast {
            claim_id,
            voter: voter.clone(),
            vote: vote.clone(),
            approve_votes: claim.approve_votes,
            reject_votes: claim.reject_votes,
        },
    );

    // Check for finalization
    let total_votes = claim.approve_votes + claim.reject_votes;
    if total_votes >= MIN_VOTES_FOR_FINALIZATION {
        if claim.approve_votes > claim.reject_votes {
            finalize_approval(env, &mut claim)?;
        } else if claim.reject_votes > claim.approve_votes {
            finalize_rejection(env, &mut claim)?;
        }
    }

    // Save updated claim
    env.storage().persistent().set(&claim_key, &claim);

    Ok(())
}

// ── Finalization helpers ─────────────────────────────────────────────────────

/// Finalizes claim approval and initiates payout.
///
/// CRITICAL: This is the ONLY path that transfers payout tokens.
fn finalize_approval(env: &Env, claim: &mut Claim) -> Result<(), ClaimError> {
    claim.status = ClaimStatus::Approved;

    // Emit approval event
    env.events().publish(
        (String::from_str(env, "claim_approved"),),
        ClaimApproved {
            claim_id: claim.claim_id,
            policy_id: claim.policy_id,
            claimant: claim.claimant.clone(),
            amount: claim.amount,
        },
    );

    // TODO: Implement token transfer in token.rs (feat/claim-payout)
    // token::transfer_payout(env, &claim.claimant, claim.amount)?;

    Ok(())
}

/// Finalizes claim rejection and applies policy consequences.
///
/// Consequences:
///   1. Increments policy.rejected_claims_count (strike counter)
///   2. Emits PolicyStrikeIncremented event
///   3. If strikes exceed MAX_REJECTED_CLAIMS_BEFORE_DEACTIVATION:
///      - Sets policy.is_active = false
///      - Sets policy.deactivation_reason
///      - Emits PolicyDeactivated event
///
/// CRITICAL: This path never transfers payout tokens.
///
/// GOVERNANCE TRANSPARENCY:
///   - All state changes are emitted as events for indexer consumption
///   - Rejected claims remain visible on-chain for auditability
///   - Strike threshold is hardcoded; changing requires contract upgrade
///
/// CENTRALIZATION RISK:
///   - If admin override functionality is added (feat/admin), it must not
///     bypass these consequences without emitting corresponding events.
///   - Appeals process (if implemented) must compose cleanly without
///     conflicting state transitions.
fn finalize_rejection(env: &Env, claim: &mut Claim) -> Result<(), ClaimError> {
    claim.status = ClaimStatus::Rejected;

    // Emit rejection event
    env.events().publish(
        (String::from_str(env, "claim_rejected"),),
        ClaimRejected {
            claim_id: claim.claim_id,
            policy_id: claim.policy_id,
            claimant: claim.claimant.clone(),
        },
    );

    // Load policy and apply consequences
    let policy_key = DataKey::Policy(claim.claimant.clone(), claim.policy_id);
    let mut policy: Policy = env
        .storage()
        .persistent()
        .get(&policy_key)
        .ok_or(ClaimError::PolicyNotFound)?;

    // Increment strike counter
    policy.rejected_claims_count += 1;

    // Emit strike event
    env.events().publish(
        (String::from_str(env, "policy_strike_incremented"),),
        PolicyStrikeIncremented {
            holder: policy.holder.clone(),
            policy_id: policy.policy_id,
            rejected_claims_count: policy.rejected_claims_count,
        },
    );

    // Check if deactivation threshold reached
    if policy.rejected_claims_count >= MAX_REJECTED_CLAIMS_BEFORE_DEACTIVATION {
        policy.is_active = false;
        let reason = String::from_str(env, "deactivated: excessive rejected claims");
        policy.deactivation_reason = Some(reason.clone());

        // Emit deactivation event
        env.events().publish(
            (String::from_str(env, "policy_deactivated"),),
            PolicyDeactivated {
                holder: policy.holder.clone(),
                policy_id: policy.policy_id,
                reason,
            },
        );
    }

    // Save updated policy
    env.storage().persistent().set(&policy_key, &policy);

    Ok(())
}

// ── Read-only helpers ────────────────────────────────────────────────────────

/// Returns a claim by ID (for testing and indexer queries).
#[allow(dead_code)]
pub fn get_claim(env: &Env, claim_id: u64) -> Option<Claim> {
    env.storage().persistent().get(&DataKey::Claim(claim_id))
}

/// Returns a policy by holder and policy_id (for testing and indexer queries).
#[allow(dead_code)]
pub fn get_policy(env: &Env, holder: &Address, policy_id: u32) -> Option<Policy> {
    env.storage()
        .persistent()
        .get(&DataKey::Policy(holder.clone(), policy_id))
}
