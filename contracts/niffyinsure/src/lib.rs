
#![no_std]

mod claim;
mod policy;
#[allow(dead_code)] // used by policy.rs once feat/policy-lifecycle lands
mod premium;
mod storage;
mod token;
pub mod types;
pub mod validate;

// ═════════════════════════════════════════════════════════════════════════════
// ORACLE / PARAMETRIC TRIGGER MODULE (experimental only)
//
// ⚠️  LEGAL / COMPLIANCE REVIEW GATE: This module is compiled ONLY when the
// `experimental` feature flag is enabled.  Default production builds cannot
// process oracle triggers.
//
// Required before activation (see DESIGN-ORACLE.md):
//   ✓ Complete cryptographic design review (signature schemes, replay protection)
//   ✓ Game-theoretic analysis (oracle incentivization, sybil resistance)
//   ✓ Legal & compliance review (regulatory classification of parametric triggers)
//   ✓ Security audit by qualified Soroban smart contract auditors
//
// Do NOT enable in production without completing all required reviews.
// ═════════════════════════════════════════════════════════════════════════════
#[cfg(feature = "experimental")]
mod oracle;

#[cfg(feature = "experimental")]
pub use oracle::*;

use soroban_sdk::{contract, contractimpl, Address, Env};

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
    // file_claim, vote_on_claim
    // implemented in claim.rs — issue: feat/claim-voting

    // ── Admin / treasury ─────────────────────────────────────────────────
    // drain
    // implemented in token.rs — issue: feat/admin
}
#![no_std]

mod claim;
mod policy;
mod premium;
mod storage;
mod token;
pub mod types;
pub mod validate;

use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec};

#[contract]
pub struct NiffyInsure;

#[contractimpl]
impl NiffyInsure {
    /// One-time initialisation: store admin and token contract address, and
    /// seed the default premium table so quote generation is deterministic.
    pub fn initialize(env: Env, admin: Address, token: Address) {
        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        storage::set_multiplier_table(&env, &premium::default_multiplier_table(&env));
        storage::set_allowed_asset(&env, &token, true);
    }

    /// Pure quote path: reads config and computes premium only.
    /// This entrypoint intentionally performs no persistent writes.
    pub fn generate_premium(
        env: Env,
        input: types::RiskInput,
        base_amount: i128,
        include_breakdown: bool,
    ) -> Result<types::PremiumQuote, validate::Error> {
        policy::generate_premium(&env, input, base_amount, include_breakdown)
    }

    pub fn quote_error_message(env: Env, code: u32) -> policy::QuoteFailure {
        let err = match code {
            1 => validate::Error::ZeroCoverage,
            2 => validate::Error::ZeroPremium,
            3 => validate::Error::InvalidLedgerWindow,
            4 => validate::Error::PolicyExpired,
            5 => validate::Error::PolicyInactive,
            6 => validate::Error::ClaimAmountZero,
            7 => validate::Error::ClaimExceedsCoverage,
            8 => validate::Error::DetailsTooLong,
            9 => validate::Error::TooManyImageUrls,
            10 => validate::Error::ImageUrlTooLong,
            11 => validate::Error::ReasonTooLong,
            12 => validate::Error::ClaimAlreadyTerminal,
            13 => validate::Error::DuplicateVote,
            14 => validate::Error::InvalidBaseAmount,
            15 => validate::Error::SafetyScoreOutOfRange,
            16 => validate::Error::InvalidConfigVersion,
            17 => validate::Error::MissingRegionMultiplier,
            18 => validate::Error::MissingAgeMultiplier,
            19 => validate::Error::MissingCoverageMultiplier,
            20 => validate::Error::RegionMultiplierOutOfBounds,
            21 => validate::Error::AgeMultiplierOutOfBounds,
            22 => validate::Error::CoverageMultiplierOutOfBounds,
            23 => validate::Error::SafetyDiscountOutOfBounds,
            24 => validate::Error::Overflow,
            25 => validate::Error::DivideByZero,
            26 => validate::Error::InvalidQuoteTtl,
            27 => validate::Error::NegativePremiumNotSupported,
            28 => validate::Error::ClaimNotFound,
            29 => validate::Error::InvalidAsset,
            30 => validate::Error::InsufficientTreasury,
            31 => validate::Error::AlreadyPaid,
            _ => validate::Error::ClaimNotApproved,
        };
        policy::map_quote_error(&env, err)
    }

    pub fn update_multiplier_table(
        env: Env,
        new_table: types::MultiplierTable,
    ) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        premium::update_multiplier_table(&env, &new_table)
    }

    pub fn get_multiplier_table(env: Env) -> types::MultiplierTable {
        storage::get_multiplier_table(&env)
    }

    pub fn set_allowed_asset(
        env: Env,
        asset: Address,
        allowed: bool,
    ) {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        claim::set_allowed_asset(&env, &asset, allowed);
    }

    pub fn is_allowed_asset(env: Env, asset: Address) -> bool {
        claim::is_allowed_asset(&env, &asset)
    }

    pub fn process_claim(env: Env, claim_id: u64) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        claim::process_claim(&env, claim_id)
    }

    pub fn get_claim(env: Env, claim_id: u64) -> Result<types::Claim, validate::Error> {
        claim::get_claim(&env, claim_id)
    }

    pub fn get_claim_counter(env: Env) -> u64 {
        storage::get_claim_counter(&env)
    }

    pub fn get_policy_counter(env: Env, holder: Address) -> u32 {
        storage::get_policy_counter(&env, &holder)
    }

    pub fn has_policy(env: Env, holder: Address, policy_id: u32) -> bool {
        storage::has_policy(&env, &holder, policy_id)
    }

    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    pub fn get_voters(env: Env) -> Vec<Address> {
        storage::get_voters(&env)
    }

    // ── Policy domain ────────────────────────────────────────────────────

    /// Turn an accepted quote into an enforceable on-chain policy.
    ///
    /// Authenticates the holder, computes premium, transfers payment,
    /// persists the policy, updates the DAO voter registry, and emits
    /// a versioned `PolicyInitiated` event for NestJS indexers.
    pub fn initiate_policy(
        env: Env,
        holder: Address,
        policy_type: types::PolicyType,
        region: types::RegionTier,
        coverage: i128,
        age: u32,
        risk_score: u32,
    ) -> Result<types::Policy, policy::PolicyError> {
        policy::initiate_policy(&env, holder, policy_type, region, coverage, age, risk_score)
    }

    /// Read-only: retrieve a persisted policy by (holder, policy_id).
    pub fn get_policy(env: Env, holder: Address, policy_id: u32) -> Option<types::Policy> {
        storage::get_policy(&env, &holder, policy_id)
    }

    /// Read-only: number of active policies for a holder (= vote weight).
    pub fn get_active_policy_count(env: Env, holder: Address) -> u32 {
        storage::get_active_policy_count(&env, &holder)
    }

    // ── Admin / pause ────────────────────────────────────────────────────

    /// Admin-only: pause the contract (blocks initiate_policy and future
    /// mutating entrypoints).
    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can pause");
        storage::set_paused(&env, true);
    }

    /// Admin-only: unpause the contract.
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can unpause");
        storage::set_paused(&env, false);
    }

    /// Read-only: check if the contract is paused.
    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    // ── Admin / treasury ─────────────────────────────────────────────────
    // drain, set_paused
    // implemented in token.rs — issue: feat/admin

    // ── Test-only helpers ─────────────────────────────────────────────────
    // These are NOT part of the production ABI; they exist solely to let
    // integration tests seed state without the full policy-lifecycle feature.
    // Gated behind the `testutils` feature so they are excluded from WASM builds.

    /// Seed a policy record and register the holder as a voter.
    #[cfg(feature = "testutils")]
    pub fn test_seed_policy(
        env: Env,
        holder: Address,
        policy_id: u32,
        coverage: i128,
        end_ledger: u32,
    ) {
        use crate::types::{Policy, PolicyType, RegionTier};
        let policy = Policy {
            holder: holder.clone(),
            policy_id,
            policy_type: PolicyType::Auto,
            region: RegionTier::Medium,
            premium: 10_000_000,
            coverage,
            is_active: true,
            start_ledger: 1,
            end_ledger,
        };
        env.storage()
            .persistent()
            .set(&storage::DataKey::Policy(holder.clone(), policy_id), &policy);
        storage::add_voter(&env, &holder);
    }

    /// Remove a holder from the live voter set (simulates policy termination).
    #[cfg(feature = "testutils")]
    pub fn test_remove_voter(env: Env, holder: Address) {
        storage::remove_voter(&env, &holder);
    }
}

// Re-export error type so tests can reference it without the module path.
pub use claim::ContractError;
