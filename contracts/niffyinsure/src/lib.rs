#![no_std]

mod claim;
mod policy;
#[allow(dead_code)] // used by policy.rs once feat/policy-lifecycle lands
mod premium;
pub mod storage;
mod token;
pub mod types;
pub mod validate;

use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec};

#[contract]
pub struct NiffyInsure;

#[contractimpl]
impl NiffyInsure {
    /// One-time initialisation: store admin and token contract address.
    /// Must be called immediately after deployment.
    pub fn initialize(env: Env, admin: Address, token: Address) {
        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
    }

    /// Pure quote path: reads config and computes premium only.
    /// This entrypoint intentionally performs no persistent writes.
    pub fn generate_premium(
        env: Env,
        policy_type: types::PolicyType,
        region: types::RegionTier,
        age: u32,
        risk_score: u32,
        include_breakdown: bool,
    ) -> Result<types::PremiumQuote, policy::QuoteError> {
        policy::generate_premium(
            &env,
            policy_type,
            region,
            age,
            risk_score,
            include_breakdown,
        )
    }

    /// Converts quote failure codes to support-friendly messages for API layers.
    pub fn quote_error_message(env: Env, code: u32) -> policy::QuoteFailure {
        let err = match code {
            1 => policy::QuoteError::InvalidAge,
            2 => policy::QuoteError::InvalidRiskScore,
            3 => policy::QuoteError::InvalidQuoteTtl,
            _ => policy::QuoteError::ArithmeticOverflow,
        };
        policy::map_quote_error(&env, err)
    }

    /// Read-only helper for monitoring state in tests / ops tooling.
    pub fn get_claim_counter(env: Env) -> u64 {
        storage::get_claim_counter(&env)
    }

    /// Read-only helper for monitoring state in tests / ops tooling.
    pub fn get_policy_counter(env: Env, holder: Address) -> u32 {
        storage::get_policy_counter(&env, &holder)
    }

    /// Read-only helper for monitoring state in tests / ops tooling.
    pub fn has_policy(env: Env, holder: Address, policy_id: u32) -> bool {
        storage::has_policy(&env, &holder, policy_id)
    }

    // ── Policy domain ────────────────────────────────────────────────────
    // generate_premium, initiate_policy, renew_policy, terminate_policy
    // implemented in policy.rs — issue: feat/policy-lifecycle

    // ── Claim domain ─────────────────────────────────────────────────────

    /// Files a new claim against an active policy.
    ///
    /// Returns claim_id on success.
    ///
    /// Validation:
    ///   - Policy must exist and be active
    ///   - Claimant must be the policy holder
    ///   - Amount must be > 0 and ≤ policy.coverage
    ///   - Details must be ≤ DETAILS_MAX_LEN bytes
    ///   - image_urls must have ≤ IMAGE_URLS_MAX items, each ≤ IMAGE_URL_MAX_LEN bytes
    pub fn file_claim(
        env: Env,
        claimant: Address,
        policy_id: u32,
        amount: i128,
        details: String,
        image_urls: Vec<String>,
    ) -> Result<u64, types::ClaimError> {
        claim::file_claim(&env, claimant, policy_id, amount, details, image_urls)
    }

    /// Casts a vote on a claim.
    ///
    /// Validation:
    ///   - Claim must exist and be in Processing state
    ///   - Voter must have an active policy
    ///   - Voter cannot vote twice on the same claim
    ///
    /// State transitions:
    ///   - Processing → Approved: if approve_votes reaches majority
    ///   - Processing → Rejected: if reject_votes reaches majority
    ///
    /// Rejection consequences:
    ///   - Increments policy.rejected_claims_count
    ///   - Deactivates policy if strikes exceed threshold
    ///   - Emits PolicyStrikeIncremented and PolicyDeactivated events
    pub fn vote_on_claim(
        env: Env,
        voter: Address,
        claim_id: u64,
        vote: types::VoteOption,
    ) -> Result<(), types::ClaimError> {
        claim::vote_on_claim(&env, voter, claim_id, vote)
    }

    /// Returns a claim by ID (read-only helper for testing and indexers).
    pub fn get_claim(env: Env, claim_id: u64) -> Option<types::Claim> {
        claim::get_claim(&env, claim_id)
    }

    /// Returns a policy by holder and policy_id (read-only helper).
    pub fn get_policy(env: Env, holder: Address, policy_id: u32) -> Option<types::Policy> {
        claim::get_policy(&env, &holder, policy_id)
    }

    // ── Admin / treasury ─────────────────────────────────────────────────
    // drain
    // implemented in token.rs — issue: feat/admin
}
