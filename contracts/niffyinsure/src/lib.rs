#![no_std]

mod calculator;
mod claim;
mod ledger;
mod policy;
mod policy_lifecycle;
mod premium;
mod storage;
mod token;
pub mod types;
pub mod validate;
pub mod admin;

#[cfg(feature = "experimental")]
mod oracle;
#[cfg(feature = "experimental")]
pub use oracle::*;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Vec};

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
        policy::generate_premium(
            &env,
            input.region,
            input.age_band,
            input.coverage,
            input.safety_score,
            base_amount,
            include_breakdown,
        )
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

    /// Admin-only: add or remove an asset from the allowlist.
    /// Emits ("asset", "added") or ("asset", "removed") for indexers.
    pub fn set_allowed_asset(env: Env, asset: Address, allowed: bool) {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        storage::bump_instance(&env);
        claim::set_allowed_asset(&env, &asset, allowed);
        env.events().publish(
            (symbol_short!("asset"), if allowed { symbol_short!("added") } else { symbol_short!("removed") }),
            asset,
        );
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

    pub fn get_voters(env: Env) -> Vec<Address> {
        storage::get_voters(&env)
    }

    // ── Policy domain ────────────────────────────────────────────────────

    /// Turn an accepted quote into an enforceable on-chain policy.
    ///
    /// `asset` must be on the admin-controlled allowlist; it is bound to the
    /// policy and used for both premium payment and future claim payouts.
    pub fn initiate_policy(
        env: Env,
        holder: Address,
        policy_type: types::PolicyType,
        region: types::RegionTier,
        age_band: types::AgeBand,
        coverage_type: types::CoverageType,
        safety_score: u32,
        base_amount: i128,
        asset: Address,
    ) -> Result<types::Policy, policy::PolicyError> {
        policy::initiate_policy(
            &env, holder, policy_type, region,
            age_band, coverage_type, safety_score, base_amount, asset,
        )
    }

    /// Read-only: retrieve a persisted policy by (holder, policy_id).
    pub fn get_policy(env: Env, holder: Address, policy_id: u32) -> Option<types::Policy> {
        storage::get_policy(&env, &holder, policy_id)
    }

    /// Read-only: number of active policies for a holder (= vote weight).
    pub fn get_active_policy_count(env: Env, holder: Address) -> u32 {
        storage::get_active_policy_count(&env, &holder)
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // PAUSE SYSTEM
    //
    // Granular pause flags for operational flexibility:
    //   - bind_paused: blocks new policy initiation/renewal
    //   - claims_paused: blocks filing claims and voting
    //
    // Admin-only toggles with optional reason codes.
    // Read-only methods continue to work for transparency.
    // ═════════════════════════════════════════════════════════════════════════════

    /// Pause the contract with optional reason code.
    /// Reason codes: 0=maintenance, 1=vulnerability, 2=key_compromise, 3=other
    /// Emits PauseToggled event with admin, paused=true, and reason code.
    pub fn pause(env: Env, admin: Address, reason_code: u32) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can pause");
        storage::set_paused(&env, true);
        
        // Emit PauseToggled event for monitoring
        env.events().publish(
            (symbol_short!("p_toggle"),),
            (admin, true, reason_code),
        );
    }

    /// Unpause the contract with optional reason code.
    /// Reason codes: 0=resolved, 1=manual, 2=other
    /// Emits PauseToggled event with admin, paused=false, and reason code.
    pub fn unpause(env: Env, admin: Address, reason_code: u32) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can unpause");
        storage::set_paused(&env, false);
        
        // Emit PauseToggled event for monitoring
        env.events().publish(
            (symbol_short!("p_toggle"),),
            (admin, false, reason_code),
        );
    }

    /// Granular pause: pause only policy binding (initiate/renew).
    pub fn pause_bind(env: Env, admin: Address, reason_code: u32) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can pause");
        
        let mut flags = storage::get_pause_flags(&env);
        flags.bind_paused = true;
        storage::set_pause_flags(&env, &flags);
        
        env.events().publish(
            (symbol_short!("p_toggle"),),
            (admin, true, reason_code),
        );
    }

    /// Granular pause: pause only claims (file/vote/finalize).
    pub fn pause_claims(env: Env, admin: Address, reason_code: u32) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can pause");
        
        let mut flags = storage::get_pause_flags(&env);
        flags.claims_paused = true;
        storage::set_pause_flags(&env, &flags);
        
        env.events().publish(
            (symbol_short!("p_toggle"),),
            (admin, true, reason_code),
        );
    }

    /// Get current pause state (legacy - true if ANY pause flag is set).
    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    /// Get detailed pause flags (bind_paused, claims_paused).
    pub fn get_pause_flags(env: Env) -> storage::PauseFlags {
        storage::get_pause_flags(&env)
    }

    // ── Test-only helpers ─────────────────────────────────────────────────

    #[cfg(feature = "testutils")]
    pub fn test_seed_policy(
        env: Env,
        holder: Address,
        policy_id: u32,
        coverage: i128,
        end_ledger: u32,
    ) {
        use crate::types::{AgeBand, CoverageType, Policy, PolicyType, RegionTier};
        let token = storage::get_token(&env);
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
            asset: token,
        };
        env.storage()
            .persistent()
            .set(&storage::DataKey::Policy(holder.clone(), policy_id), &policy);
        storage::add_voter(&env, &holder);
    }

    #[cfg(feature = "testutils")]
    pub fn test_remove_voter(env: Env, holder: Address) {
        storage::remove_voter(&env, &holder);
    }
}
