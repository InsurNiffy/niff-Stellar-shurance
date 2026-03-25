#![no_std]

mod claim;
mod policy;
pub mod premium;
mod storage;
mod token;
pub mod types;
pub mod validate;

use soroban_sdk::{contract, contractimpl, Address, Env};

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
}
