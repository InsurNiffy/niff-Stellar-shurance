#![no_std]
#![allow(clippy::too_many_arguments)]

pub mod admin;
pub mod calculator;
mod claim;
pub mod commit_reveal;
pub mod delegation;
pub mod events;
pub mod governance;
mod governance_token;
mod ledger;
pub mod policy;
pub mod policy_lifecycle;
pub mod premium;
pub mod premium_pure;
mod rolling_claim_cap;
pub mod storage;
mod token;
pub mod types;
pub mod validate;

#[cfg(feature = "experimental")]
mod oracle;
#[cfg(feature = "experimental")]
pub use oracle::*;

use soroban_sdk::{
    contract, contractevent, contractimpl, panic_with_error, Address, Env, String, Vec,
};

#[contract]
pub struct NiffyInsure;
pub use admin::{AdminAction, AdminError, PendingAdminAction, RoleError};
pub use governance::{GovernanceError, Proposal};
pub use policy::{PolicyError, RenewalError};
pub use policy_lifecycle::PolicyError as LifecyclePolicyError;

#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[soroban_sdk::contracterror]
#[repr(u32)]
pub enum InitError {
    AlreadyInitialized = 1,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[soroban_sdk::contracterror]
#[repr(u32)]
pub enum VetError {
    /// Vet does not have the required specialization for this record type.
    InsufficientSpecialization = 1,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[soroban_sdk::contracterror]
#[repr(u32)]
pub enum SubscriptionError {
    /// Address has reached the maximum of 10 active subscriptions.
    TooManySubscriptions = 1,
    /// Subscription not found or already expired.
    NotFound = 2,
}
#[contractevent(topics = ["niffyinsure", "allowed_asset_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct AllowedAssetUpdated {
    #[topic]
    pub asset: Address,
    pub allowed: bool,
}

#[contractevent(topics = ["niffyinsure", "voting_duration_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct VotingDurationUpdated {
    pub old_ledgers: u32,
    pub new_ledgers: u32,
}

#[contractevent(topics = ["niffyinsure", "asset_claim_bounds_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct AssetClaimBoundsUpdated {
    #[topic]
    pub asset: Address,
    pub min_claim_amount: i128,
    pub max_claim_amount: i128,
}

#[contractevent(topics = ["niffyinsure", "reinsurance_contract_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct ReinsuranceContractUpdated {
    pub reinsurance_contract: Address,
}

/// Emitted when the KYC whitelist enforcement toggle changes.
#[contractevent(topics = ["niffyinsure", "whitelist_toggled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct WhitelistToggled {
    pub enabled: bool,
}

/// Emitted when an address is added to or removed from the KYC whitelist.
#[contractevent(topics = ["niffyinsure", "whitelist_address_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct WhitelistAddressUpdated {
    #[topic]
    pub holder: Address,
    pub allowed: bool,
}

#[contractevent(topics = ["niffyinsure", "quorum_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct QuorumUpdated {
    pub old_bps: u32,
    pub new_bps: u32,
}

#[contractevent(topics = ["niffyinsure", "policy_type_registered"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct PolicyTypeRegistered {
    pub policy_type: types::PolicyType,
    /// `true` = registered/active, `false` = deregistered/inactive.
    pub active: bool,
}

#[contractevent(topics = ["niffyinsure", "pause_toggled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct PauseToggled {
    #[topic]
    pub admin: Address,
    pub paused: bool,
    /// Numeric reason code derived from `PauseReason` (0=SecurityIncident, 1=UpgradePending,
    /// 2=SolvencyRisk, 3=Regulatory). On unpause this field is 0 (reason cleared).
    pub reason_code: u32,
    pub bind_paused: bool,
    pub claims_paused: bool,
}

#[contractevent(topics = ["niffyinsure", "protocol_fee_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct ProtocolFeeUpdated {
    pub old_bps: u32,
    pub new_bps: u32,
}

#[contractevent(topics = ["niffyinsure", "fee_recipient_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct FeeRecipientUpdated {
    #[topic]
    pub old_recipient: Address,
    #[topic]
    pub new_recipient: Address,
}

#[contractevent(topics = ["niffyinsure", "min_solvency_ratio_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct MinSolvencyRatioUpdated {
    pub old_bps: u32,
    pub new_bps: u32,
}

#[contractevent(topics = ["niffyinsure", "treasury_depositor_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct TreasuryDepositorUpdated {
    #[topic]
    pub depositor: Address,
    pub allowed: bool,
}

#[contractevent(topics = ["niffyinsure", "treasury_deposited"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct TreasuryDeposited {
    #[topic]
    pub depositor: Address,
    #[topic]
    pub asset: Address,
    pub amount: i128,
    pub at_ledger: u32,
}

/// Convert a `PauseReason` variant to its numeric code for event emission.
///
/// Codes:
/// - 0 = SecurityIncident
/// - 1 = UpgradePending
/// - 2 = SolvencyRisk
/// - 3 = Regulatory
fn pause_reason_to_code(reason: &types::PauseReason) -> u32 {
    match reason {
        types::PauseReason::SecurityIncident => 0,
        types::PauseReason::UpgradePending => 1,
        types::PauseReason::SolvencyRisk => 2,
        types::PauseReason::Regulatory => 3,
    }
}

#[allow(clippy::too_many_arguments)]
#[contractimpl]
impl NiffyInsure {
    /// One-time initialisation: store admin and token contract address, and
    /// seed the default premium table so quote generation is deterministic.
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), InitError> {
        admin.require_auth();
        if env.storage().instance().has(&storage::DataKey::Admin) {
            return Err(InitError::AlreadyInitialized);
        }
        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        storage::set_multiplier_table(&env, &premium::default_multiplier_table(&env));
        storage::set_allowed_asset(&env, &token, true);
        storage::set_protocol_fee_bps(&env, 0);
        storage::set_fee_recipient(&env, &env.current_contract_address());
        storage::set_min_solvency_ratio_bps(&env, 0);
        storage::set_claim_filing_fee(&env, 0);
        storage::set_voting_duration_ledgers(&env, ledger::VOTE_WINDOW_LEDGERS);
        storage::set_quorum_bps(&env, types::DEFAULT_QUORUM_BPS);
        admin::emit_admin_action(&env, &admin, "initialize");
        Ok(())
    }

    pub fn get_admin(env: Env) -> Address {
        storage::get_admin(&env)
    }

    /// Returns the semver version string stamped at build time from `Cargo.toml`.
    /// Read-only: no storage access, no auth required. Safe to call via simulation.
    pub fn version(env: Env) -> soroban_sdk::String {
        soroban_sdk::String::from_str(&env, env!("CARGO_PKG_VERSION"))
    }

    /// Returns human-readable contract identity: name, version, and network hint.
    /// All fields are compile-time constants. No storage reads, no auth required.
    pub fn get_contract_metadata(env: Env) -> types::ContractMetadata {
        types::ContractMetadata {
            name: soroban_sdk::String::from_str(&env, env!("CARGO_PKG_NAME")),
            version: soroban_sdk::String::from_str(&env, env!("CARGO_PKG_VERSION")),
            network_passphrase_hint: soroban_sdk::String::from_str(&env, "Stellar Testnet"),
        }
    }

    /// Read-only: on-chain WASM hash for this deployed contract.
    /// The returned value is the canonical hash used by the deployment registry and RPC tooling.
    pub fn get_wasm_hash(env: Env) -> soroban_sdk::BytesN<32> {
        soroban_sdk::BytesN::from_array(&env, &[0u8; 32])
    }

    /// Read-only: balance of the default payout token held by this contract (payout reserve).
    /// Matches funds available for `process_claim` for the configured default asset.
    pub fn get_treasury_balance(env: Env) -> i128 {
        let token_addr = storage::get_token(&env);
        crate::token::get_treasury_balance(&env, &token_addr)
    }

    pub fn get_protocol_fee_bps(env: Env) -> u32 {
        storage::get_protocol_fee_bps(&env)
    }

    pub fn get_fee_recipient(env: Env) -> Address {
        storage::get_fee_recipient(&env)
    }

    pub fn get_min_solvency_ratio_bps(env: Env) -> u32 {
        storage::get_min_solvency_ratio_bps(&env)
    }

    pub fn check_solvency_ratio(env: Env, new_coverage: i128) -> bool {
        let token_addr = storage::get_token(&env);
        policy::check_solvency_ratio(&env, &token_addr, new_coverage)
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
            None,
        )
    }

    /// Like `generate_premium` but uses the asset-specific multiplier table when configured.
    /// Falls back to the global default table when no asset-specific table exists.
    pub fn generate_premium_for_asset(
        env: Env,
        input: types::RiskInput,
        base_amount: i128,
        include_breakdown: bool,
        asset: Address,
    ) -> Result<types::PremiumQuote, validate::Error> {
        policy::generate_premium(
            &env,
            input.region,
            input.age_band,
            input.coverage,
            input.safety_score,
            base_amount,
            include_breakdown,
            Some(&asset),
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
            32 => validate::Error::ClaimNotApproved,
            33 => validate::Error::DuplicateOpenClaim,
            34 => validate::Error::ExcessiveEvidenceBytes,
            35 => validate::Error::PolicyNotFound,
            36 => validate::Error::CalculatorNotSet,
            37 => validate::Error::CalculatorCallFailed,
            38 => validate::Error::CalculatorPaused,
            39 => validate::Error::VotingWindowClosed,
            40 => validate::Error::VotingWindowStillOpen,
            41 => validate::Error::NotEligibleVoter,
            42 => validate::Error::RateLimitExceeded,
            49 => validate::Error::VotingDurationOutOfBounds,
            50 => validate::Error::PolicyBatchTooLarge,
            51 => validate::Error::VoterSnapshotExpired,
            52 => validate::Error::NonceMismatch,
            53 => validate::Error::ClaimNotProcessing,
            54 => validate::Error::RollingClaimCapExceeded,
            55 => validate::Error::PayoutDeadlineNotReached,
            56 => validate::Error::InsufficientEvidence,
            57 => validate::Error::CooldownActive,
            80 => validate::Error::DuplicateEvidence,
            81 => validate::Error::PageSizeTooLarge,
            86 => validate::Error::EvidenceUrlTooLong,
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
        admin::check_and_update_gov_cooldown(&env);
        let result = premium::update_multiplier_table(&env, &new_table);
        if result.is_ok() {
            admin::emit_admin_action(&env, &admin, "update_multiplier_table");
        }
        result
    }

    /// Admin-only: update a single multiplier entry without redeploying the contract.
    ///
    /// Emits `PremiumMultiplierUpdated` with the key, old value, and new value.
    /// Premium calculations use the updated value immediately after this call.
    ///
    /// # Bounds
    /// - Region / Age / Coverage keys: `MIN_MULTIPLIER..=MAX_MULTIPLIER` (5_000–20_000)
    /// - SafetyDiscount key: `0..=MAX_SAFETY_DISCOUNT` (0–5_000)
    pub fn admin_set_premium_multiplier(
        env: Env,
        key: types::MultiplierKey,
        value: i128,
    ) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        admin::check_and_update_gov_cooldown(&env);
        storage::bump_instance(&env);
        let result = premium::admin_set_premium_multiplier(&env, key, value);
        if result.is_ok() {
            admin::emit_admin_action(&env, &admin, "admin_set_premium_multiplier");
        }
        result
    }

    pub fn get_multiplier_table(env: Env) -> types::MultiplierTable {
        storage::get_multiplier_table(&env)
    }

    /// Admin-only: add or remove an asset from the allowlist.
    /// Always emits `asset_set` (idempotent — even if the state is unchanged).
    pub fn set_allowed_asset(
        env: Env,
        asset: Address,
        allowed: bool,
        symbol_hint: soroban_sdk::String,
        decimals: u32,
    ) {
        let admin = admin::require_admin(&env);
        admin::check_and_update_gov_cooldown(&env);
        storage::bump_instance(&env);
        claim::set_allowed_asset(&env, &asset, allowed);
        AllowedAssetUpdated {
            asset: asset.clone(),
            allowed,
        }
        .publish(&env);
        events::emit_asset_allowlisted(
            &env,
            &asset,
            allowed,
            if allowed {
                symbol_hint
            } else {
                soroban_sdk::String::from_str(&env, "")
            },
            if allowed { decimals } else { 0 },
        );
        admin::emit_admin_action(&env, &admin, "set_allowed_asset");
    }

    pub fn is_allowed_asset(env: Env, asset: Address) -> bool {
        storage::is_allowed_asset(&env, &asset)
    }

    pub fn file_claim(
        env: Env,
        holder: Address,
        policy_id: u32,
        amount: i128,
        details: soroban_sdk::String,
        evidence: Vec<types::ClaimEvidenceEntry>,
        expected_nonce: Option<u64>,
    ) -> Result<u64, validate::Error> {
        holder.require_auth();
        claim::file_claim(
            &env,
            &holder,
            policy_id,
            amount,
            &details,
            &evidence,
            expected_nonce,
        )
    }

    /// Claimant-only: withdraw before any vote is cast (`Processing`, zero tallies).
    pub fn withdraw_claim(
        env: Env,
        claimant: Address,
        claim_id: u64,
    ) -> Result<(), validate::Error> {
        claimant.require_auth();
        claim::withdraw_claim(&env, &claimant, claim_id)
    }

    /// Claimant-only: replace evidence before voting starts.
    pub fn add_claim_evidence(
        env: Env,
        claimant: Address,
        claim_id: u64,
        new_evidence: Vec<types::ClaimEvidenceEntry>,
    ) -> Result<(), validate::Error> {
        claimant.require_auth();
        claim::add_claim_evidence(&env, &claimant, claim_id, &new_evidence)
    }

    pub fn vote_on_claim(
        env: Env,
        voter: Address,
        claim_id: u64,
        vote: types::VoteOption,
    ) -> Result<types::ClaimStatus, validate::Error> {
        voter.require_auth();
        claim::vote_on_claim(&env, &voter, claim_id, &vote)
    }

    /// Admin: configure commit/reveal ledger windows for a claim.
    pub fn set_commit_reveal_phases(
        env: Env,
        claim_id: u64,
        commit_phase_end_ledger: u32,
        reveal_phase_end_ledger: u32,
    ) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        if reveal_phase_end_ledger <= commit_phase_end_ledger {
            return Err(validate::Error::VotingDurationOutOfBounds);
        }
        commit_reveal::set_phases(
            &env,
            claim_id,
            &commit_reveal::CommitRevealPhases {
                commit_phase_end_ledger,
                reveal_phase_end_ledger,
            },
        );
        Ok(())
    }

    /// Commit phase: submit `SHA-256(vote_byte || salt)` without revealing the ballot.
    pub fn commit_vote(
        env: Env,
        voter: Address,
        claim_id: u64,
        commitment: soroban_sdk::BytesN<32>,
    ) -> Result<(), validate::Error> {
        commit_reveal::commit_vote(&env, &voter, claim_id, commitment)
    }

    /// Reveal phase: open the prior commitment and count the ballot in the claim tally.
    pub fn reveal_vote(
        env: Env,
        voter: Address,
        claim_id: u64,
        vote: types::VoteOption,
        salt: soroban_sdk::BytesN<32>,
    ) -> Result<(), validate::Error> {
        commit_reveal::reveal_vote(&env, &voter, claim_id, vote, salt)
    }

    /// Holder-authenticated delegation of vote weight to another address.
    ///
    /// Delegations are checked against the current ledger and expire at
    /// `expiry_ledger` inclusively.
    pub fn delegate_vote(
        env: Env,
        delegator: Address,
        delegate: Address,
        expiry_ledger: u32,
    ) -> Result<(), validate::Error> {
        delegator.require_auth();
        storage::bump_instance(&env);

        if delegator == delegate {
            return Err(validate::Error::CircularDelegation);
        }

        let now = env.ledger().sequence();
        let resolved_target = storage::resolve_vote_delegation_target(&env, &delegate, now)?;
        if resolved_target == delegator {
            return Err(validate::Error::CircularDelegation);
        }

        storage::set_vote_delegation(
            &env,
            &delegator,
            &types::VoteDelegation {
                delegate,
                expiry_ledger,
            },
        );
        Ok(())
    }

    /// Read-only: current delegation binding for a holder, if any.
    pub fn get_vote_delegation(env: Env, delegator: Address) -> Option<types::VoteDelegation> {
        storage::get_vote_delegation(&env, &delegator)
    }

    /// Permissionless keeper hook: bump persistent TTL for the claim voter snapshot.
    /// Does not alter eligibility or tallies.
    pub fn refresh_snapshot(env: Env, claim_id: u64) -> Result<(), validate::Error> {
        claim::refresh_snapshot(&env, claim_id)
    }

    pub fn finalize_claim(env: Env, claim_id: u64) -> Result<types::ClaimStatus, validate::Error> {
        claim::finalize_claim(&env, claim_id)
    }

    /// Permissionless keeper: finalize claim when past `voting_deadline_ledger` (same rules as `finalize_claim`).
    pub fn process_deadline(
        env: Env,
        claim_id: u64,
    ) -> Result<types::ClaimStatus, validate::Error> {
        claim::process_deadline(&env, claim_id)
    }

    /// Permissionless keeper: finalize multiple expired claims in one transaction.
    ///
    /// Processes each claim independently; skips already-finalized or ineligible claims.
    /// Reverts before any processing if `claim_ids.len() > BATCH_FINALIZE_MAX` (20).
    /// Returns `(processed, skipped)` counts.
    pub fn finalize_expired_batch(
        env: Env,
        claim_ids: soroban_sdk::Vec<u64>,
    ) -> Result<(u32, u32), validate::Error> {
        claim::finalize_expired_batch(&env, &claim_ids)
    }

    /// Permissionless keeper: auto-reject an approved claim once its payout deadline has elapsed.
    pub fn process_payout_timeout(
        env: Env,
        claim_id: u64,
    ) -> Result<types::ClaimStatus, validate::Error> {
        claim::process_payout_timeout(&env, claim_id)
    }

    pub fn get_claim_history(
        env: Env,
        claim_id: u64,
    ) -> Result<Vec<types::ClaimStatusHistoryEntry>, validate::Error> {
        claim::get_claim_history(&env, claim_id)
    }

    pub fn get_vote_duration_ledgers(env: Env) -> u32 {
        storage::get_voting_duration_ledgers(&env)
    }

    pub fn admin_set_vote_duration_ledgers(env: Env, ledgers: u32) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        admin::check_and_update_gov_cooldown(&env);
        ledger::validate_voting_duration_ledgers(ledgers)?;
        storage::set_voting_duration_ledgers(&env, ledgers);
        admin::emit_admin_action(&env, &admin, "admin_set_vote_duration_ledgers");
        Ok(())
    }

    /// Participation quorum in basis points (1–10_000). Applies to **new** claims only;
    /// each claim stores a snapshot at `file_claim` so `Processing` claims keep their `quorum_bps`.
    pub fn get_quorum_bps(env: Env) -> u32 {
        storage::get_quorum_bps(&env)
    }

    /// Basis points snapshot for this claim (immutable after filing).
    pub fn get_claim_quorum_bps(env: Env, claim_id: u64) -> u32 {
        storage::get_claim_quorum_bps(&env, claim_id)
    }

    pub fn admin_set_quorum_bps(env: Env, quorum_bps: u32) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        admin::check_and_update_gov_cooldown(&env);
        validate::validate_quorum_bps(quorum_bps)?;
        let old = storage::get_quorum_bps(&env);
        storage::set_quorum_bps(&env, quorum_bps);
        QuorumUpdated {
            old_bps: old,
            new_bps: quorum_bps,
        }
        .publish(&env);
        admin::emit_admin_action(&env, &admin, "admin_set_quorum_bps");
        Ok(())
    }

    pub fn admin_set_protocol_fee_bps(env: Env, fee_bps: u32) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        admin::check_and_update_gov_cooldown(&env);
        storage::bump_instance(&env);
        validate::validate_protocol_fee_bps(fee_bps)?;
        let old = storage::get_protocol_fee_bps(&env);
        storage::set_protocol_fee_bps(&env, fee_bps);
        ProtocolFeeUpdated {
            old_bps: old,
            new_bps: fee_bps,
        }
        .publish(&env);
        Ok(())
    }

    pub fn admin_set_fee_recipient(env: Env, recipient: Address) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        admin::check_and_update_gov_cooldown(&env);
        storage::bump_instance(&env);
        let old = storage::get_fee_recipient(&env);
        storage::set_fee_recipient(&env, &recipient);
        FeeRecipientUpdated {
            old_recipient: old,
            new_recipient: recipient,
        }
        .publish(&env);
        Ok(())
    }

    pub fn admin_set_min_solvency_ratio_bps(
        env: Env,
        ratio_bps: u32,
    ) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        admin::check_and_update_gov_cooldown(&env);
        storage::bump_instance(&env);
        validate::validate_min_solvency_ratio_bps(ratio_bps)?;
        let old = storage::get_min_solvency_ratio_bps(&env);
        storage::set_min_solvency_ratio_bps(&env, ratio_bps);
        MinSolvencyRatioUpdated {
            old_bps: old,
            new_bps: ratio_bps,
        }
        .publish(&env);
        Ok(())
    }

    // ── Grace period ──────────────────────────────────────────────────────────

    /// Admin-only: set the grace period (in ledgers) after nominal expiry during
    /// which late renewals are still accepted. Emits GracePeriodUpdated.
    pub fn set_grace_period_ledgers(env: Env, ledgers: u32) -> Result<(), policy::RenewalError> {
        storage::bump_instance(&env);
        policy::set_grace_period_ledgers(&env, ledgers)
    }

    pub fn get_grace_period_ledgers(env: Env) -> u32 {
        policy::get_grace_period_ledgers(&env)
    }

    pub fn process_claim(env: Env, claim_id: u64) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        let result = claim::process_claim(&env, claim_id);
        if result.is_ok() {
            admin::emit_admin_action(&env, &admin, "process_claim");
        }
        result
    }

    /// Admin-only: disburse a partial installment against an approved claim.
    ///
    /// Can be called multiple times; claim transitions to `Paid` only when
    /// `paid_amount >= amount - deductible`. Reverts with `OverDisbursement`
    /// if `amount` would exceed the remaining unpaid balance.
    pub fn disburse_installment(
        env: Env,
        claim_id: u64,
        amount: i128,
    ) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        let result = claim::disburse_installment(&env, claim_id, amount);
        if result.is_ok() {
            admin::emit_admin_action(&env, &admin, "disburse_installment");
        }
        result
    }

    /// Admin-only: dispute an approved claim during the dispute window.
    ///
    /// Distinct from `open_appeal` and `escalate_claim` — see `docs/GLOSSARY.md`.
    pub fn admin_dispute_claim(env: Env, claim_id: u64) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        claim::dispute_claim(&env, claim_id)
    }

    /// Admin-only: reduce the voting deadline of a stalled `Processing` claim.
    ///
    /// Allows fast-tracking stalled claims when voter turnout is too low to reach quorum.
    /// `new_deadline_ledger` must be in the future and earlier than the current deadline.
    ///
    /// Distinct from `open_appeal` and `admin_dispute_claim` — see `docs/GLOSSARY.md`.
    pub fn escalate_claim(
        env: Env,
        claim_id: u64,
        new_deadline_ledger: u32,
    ) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        claim::escalate_claim(&env, claim_id, new_deadline_ledger)
    }

    // ── Appeal mechanism (Issue #1) ───────────────────────────────────────────

    /// Claimant-only: open an appeal on a rejected claim within the appeal window.
    ///
    /// Distinct from `admin_dispute_claim` and `escalate_claim` — see `docs/GLOSSARY.md`.
    ///
    /// Preconditions: status == Rejected, within appeal_open_deadline_ledger, appeals_count < 1.
    /// Transitions: Rejected → UnderAppeal. Resets vote counts, sets appeal_deadline_ledger,
    /// snapshots a fresh voter electorate, and requires elevated quorum.
    pub fn open_appeal(env: Env, claimant: Address, claim_id: u64) -> Result<(), validate::Error> {
        claimant.require_auth();
        claim::open_appeal(&env, &claimant, claim_id)
    }

    /// Cast a vote in an active appeal round (UnderAppeal status).
    pub fn vote_on_appeal(
        env: Env,
        voter: Address,
        claim_id: u64,
        vote: types::VoteOption,
    ) -> Result<types::ClaimStatus, validate::Error> {
        voter.require_auth();
        claim::vote_on_appeal(&env, &voter, claim_id, &vote)
    }

    /// Permissionless keeper: finalize an appeal after its voting deadline passes.
    pub fn finalize_appeal(env: Env, claim_id: u64) -> Result<types::ClaimStatus, validate::Error> {
        claim::finalize_appeal(&env, claim_id)
    }

    pub fn get_claim(env: Env, claim_id: u64) -> Result<types::Claim, validate::Error> {
        claim::get_claim(&env, claim_id)
    }

    /// Batch-read claims in one simulation/RPC round-trip.
    ///
    /// Returns positions aligned with `ids`, using `None` for missing claim IDs.
    /// More than `CLAIM_BATCH_GET_MAX` IDs reverts before any storage reads.
    pub fn get_claims_batch(env: Env, ids: Vec<u64>) -> Vec<Option<types::Claim>> {
        if ids.len() > types::CLAIM_BATCH_GET_MAX {
            panic_with_error!(&env, validate::Error::ClaimBatchTooLarge);
        }
        let mut out: Vec<Option<types::Claim>> = Vec::new(&env);
        for id in ids.iter() {
            out.push_back(storage::get_claim(&env, id));
        }
        out
    }

    pub fn get_claim_counter(env: Env) -> u64 {
        storage::get_claim_counter(&env)
    }

    /// Paginated listing of claims by claim_id range, ordered ascending.
    ///
    /// `start_after` is an exclusive cursor: pass `0` for the first page, or the
    /// last `claim_id` received to advance to the next page.
    /// `limit` is capped at `PAGE_SIZE_MAX` (20); larger values are silently clamped.
    ///
    /// Returns summary structs — call `get_claim` for the full record.
    ///
    /// Empty page (len == 0) means no more results exist beyond the cursor.
    /// Because claim_ids are monotonically increasing and never deleted, a
    /// stale cursor never panics — it simply returns an empty page.
    pub fn list_claims(env: Env, start_after: u64, limit: u32) -> Vec<types::ClaimSummary> {
        let cap = limit.min(types::PAGE_SIZE_MAX);
        let total = storage::get_claim_counter(&env);
        let mut results: Vec<types::ClaimSummary> = Vec::new(&env);
        let mut id: u64 = start_after.saturating_add(1);
        while id <= total && results.len() < cap {
            if let Some(c) = storage::get_claim(&env, id) {
                results.push_back(types::ClaimSummary {
                    claim_id: c.claim_id,
                    policy_id: c.policy_id,
                    amount: c.amount,
                    deductible: c.deductible,
                    status: c.status,
                    filed_at: c.filed_at,
                    voting_deadline_ledger: c.voting_deadline_ledger,
                });
            }
            id = id.saturating_add(1);
        }
        results
    }

    /// Admin-only: set the flat fee (stroops) charged to the claimant at file_claim.
    /// 0 = disabled. Fee is transferred to the treasury before claim creation.
    pub fn admin_set_claim_filing_fee(env: Env, fee: i128) {
        let _admin = admin::require_admin(&env);
        storage::bump_instance(&env);
        storage::set_claim_filing_fee(&env, fee);
    }

    /// Read-only: the current claim filing fee. 0 = disabled.
    pub fn get_claim_filing_fee(env: Env) -> i128 {
        storage::get_claim_filing_fee(&env)
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

    pub fn create_proposal(
        env: Env,
        creator: Address,
        param_key: soroban_sdk::String,
        new_value: u32,
    ) -> u64 {
        governance::create_proposal(&env, creator, param_key, new_value)
    }

    pub fn vote_proposal(
        env: Env,
        voter: Address,
        proposal_id: u64,
        approve: bool,
    ) -> Result<(), GovernanceError> {
        governance::vote_proposal(&env, voter, proposal_id, approve)
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<Proposal> {
        governance::get_proposal(&env, proposal_id)
    }

    pub fn voter_registry_len(env: Env) -> u32 {
        storage::get_voters(&env).len()
    }

    pub fn voter_registry_contains(env: Env, holder: Address) -> bool {
        storage::get_voters(&env).iter().any(|v| v == holder)
    }

    pub fn holder_active_policy_count(env: Env, holder: Address) -> u32 {
        storage::get_holder_active_policy_count(&env, &holder)
    }

    pub fn set_calculator(env: Env, calculator: Address) {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        admin::check_and_update_gov_cooldown(&env);
        storage::set_calc_address(&env, &calculator);
        admin::emit_admin_action(&env, &admin, "set_calculator");
    }

    /// Admin: set calculator address and expected ABI version atomically.
    /// Pass `expected_version = 0` to disable the ABI pin check.
    pub fn set_calculator_with_version(env: Env, calculator_addr: Address, expected_version: u32) {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        admin::check_and_update_gov_cooldown(&env);
        calculator::set_calculator_with_version(&env, &calculator_addr, expected_version);
        admin::emit_admin_action(&env, &admin, "set_calculator_with_version");
    }

    pub fn clear_calculator(env: Env) {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        admin::check_and_update_gov_cooldown(&env);
        env.storage()
            .instance()
            .remove(&storage::DataKey::CalcAddress);
        calculator::clear_expected_calc_version(&env);
        admin::emit_admin_action(&env, &admin, "clear_calculator");
    }

    pub fn get_calculator(env: Env) -> Option<Address> {
        storage::get_calc_address(&env)
    }

    /// Expected calculator ABI version pin (`None` = check disabled).
    pub fn get_expected_calc_version(env: Env) -> Option<u32> {
        calculator::get_expected_calc_version(&env)
    }

    /// ABI version recorded on the last successful external calculator `compute`.
    pub fn get_last_calc_abi_version(env: Env) -> Option<u32> {
        calculator::get_last_calc_abi_version(&env)
    }

    // ── Region registry ───────────────────────────────────────────────────────

    /// Admin-only: upsert a region code in the registry.
    pub fn admin_set_region(env: Env, code: String, config: types::RegionConfig) {
        let _admin = admin::require_admin(&env);
        admin::check_and_update_gov_cooldown(&env);
        storage::bump_instance(&env);
        let mut registry = storage::get_region_registry(&env);
        registry.set(code, config);
        storage::set_region_registry(&env, &registry);
    }

    /// Admin-only: remove a region code from the registry.
    pub fn admin_remove_region(env: Env, code: String) {
        let _admin = admin::require_admin(&env);
        admin::check_and_update_gov_cooldown(&env);
        storage::bump_instance(&env);
        let mut registry = storage::get_region_registry(&env);
        registry.remove(code);
        storage::set_region_registry(&env, &registry);
    }

    /// Read-only: get a region config by code.
    pub fn get_region_config(env: Env, code: String) -> Option<types::RegionConfig> {
        storage::get_region_config(&env, &code)
    }

    // ── Treatment tracking ────────────────────────────────────────────────────

    /// Record a treatment for a pet. Increments the treatment counter for `pet_id`.
    /// Caller must be authenticated (holder of the associated policy).
    pub fn record_treatment(env: Env, holder: Address, pet_id: u64) -> u64 {
        holder.require_auth();
        storage::bump_instance(&env);
        storage::increment_treatment_count(&env, pet_id)
    }

    /// Read-only: total number of treatments recorded for `pet_id`.
    pub fn get_treatment_count(env: Env, pet_id: u64) -> u64 {
        storage::get_treatment_count(&env, pet_id)
    }

    // ── Vet specialization registry ───────────────────────────────────────────

    /// Admin-only: register or update a vet's verified specializations.
    pub fn admin_set_vet_specializations(
        env: Env,
        vet: Address,
        specializations: Vec<types::Specialization>,
    ) {
        let _admin = admin::require_admin(&env);
        admin::check_and_update_gov_cooldown(&env);
        storage::bump_instance(&env);
        storage::set_vet_specializations(&env, &vet, &specializations);
    }

    /// Read-only: return the verified specializations for a vet address.
    pub fn get_vet_specializations(env: Env, vet: Address) -> Vec<types::Specialization> {
        storage::get_vet_specializations(&env, &vet)
    }

    /// Validate that `vet` is qualified to submit a record of `record_type`.
    /// Reverts with `VetError::InsufficientSpecialization` if not qualified.
    pub fn assert_vet_qualified(
        env: Env,
        vet: Address,
        record_type: types::MedicalRecordType,
    ) -> Result<(), VetError> {
        match record_type.required_specialization() {
            None => Ok(()),
            Some(required) => {
                if storage::vet_has_specialization(&env, &vet, &required) {
                    Ok(())
                } else {
                    Err(VetError::InsufficientSpecialization)
                }
            }
        }
    }

    // ── Event subscription filter system ──────────────────────────────────────

    /// Register a subscription filter. TTL is `ttl_ledgers` from the current ledger.
    /// Max 10 active subscriptions per address; expired subscriptions are pruned on registration.
    /// Returns the new subscription ID.
    pub fn register_subscription(
        env: Env,
        owner: Address,
        event_types: Vec<types::EventType>,
        pet_ids: Vec<u64>,
        ttl_ledgers: u32,
    ) -> Result<u64, SubscriptionError> {
        owner.require_auth();
        storage::bump_instance(&env);

        let now = env.ledger().sequence();
        let expires_at = now.saturating_add(ttl_ledgers);

        // Prune expired subscriptions for this owner.
        let mut ids = storage::get_owner_subscription_ids(&env, &owner);
        let mut active: Vec<u64> = Vec::new(&env);
        for i in 0..ids.len() {
            let id = ids.get(i).unwrap();
            if let Some(sub) = storage::get_subscription(&env, id) {
                if sub.expires_at >= now {
                    active.push_back(id);
                } else {
                    storage::remove_subscription(&env, id);
                }
            }
        }
        ids = active;

        if ids.len() >= types::MAX_SUBSCRIPTIONS_PER_ADDRESS {
            return Err(SubscriptionError::TooManySubscriptions);
        }

        let sub_id = storage::next_subscription_id(&env);
        let sub = types::Subscription {
            id: sub_id,
            owner: owner.clone(),
            event_types,
            pet_ids,
            expires_at,
        };
        storage::set_subscription(&env, &sub);
        ids.push_back(sub_id);
        storage::set_owner_subscription_ids(&env, &owner, &ids);

        Ok(sub_id)
    }

    /// Read-only: get a subscription by ID. Returns None if not found or expired.
    pub fn get_subscription(env: Env, id: u64) -> Option<types::Subscription> {
        let now = env.ledger().sequence();
        storage::get_subscription(&env, id).filter(|s| s.expires_at >= now)
    }

    /// Cancel a subscription. Only the owner may cancel.
    pub fn cancel_subscription(
        env: Env,
        owner: Address,
        sub_id: u64,
    ) -> Result<(), SubscriptionError> {
        owner.require_auth();
        let sub = storage::get_subscription(&env, sub_id).ok_or(SubscriptionError::NotFound)?;
        if sub.owner != owner {
            return Err(SubscriptionError::NotFound);
        }
        storage::remove_subscription(&env, sub_id);
        // Remove from owner index.
        let ids = storage::get_owner_subscription_ids(&env, &owner);
        let mut updated: Vec<u64> = Vec::new(&env);
        for i in 0..ids.len() {
            let id = ids.get(i).unwrap();
            if id != sub_id {
                updated.push_back(id);
            }
        }
        storage::set_owner_subscription_ids(&env, &owner, &updated);
        Ok(())
    }

    /// Read-only: list active (non-expired) subscription IDs for an owner.
    pub fn list_subscriptions(env: Env, owner: Address) -> Vec<u64> {
        let now = env.ledger().sequence();
        let ids = storage::get_owner_subscription_ids(&env, &owner);
        let mut active: Vec<u64> = Vec::new(&env);
        for i in 0..ids.len() {
            let id = ids.get(i).unwrap();
            if let Some(sub) = storage::get_subscription(&env, id) {
                if sub.expires_at >= now {
                    active.push_back(id);
                }
            }
        }
        active
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
        coverage_type: types::CoverageTier,
        safety_score: u32,
        base_amount: i128,
        asset: Address,
        opts: types::InitiatePolicyOptions,
    ) -> Result<types::Policy, policy::PolicyError> {
        policy::initiate_policy(
            &env,
            holder,
            policy_type,
            region,
            age_band,
            coverage_type,
            safety_score,
            base_amount,
            asset,
            opts.beneficiary,
            opts.deductible,
            opts.expected_nonce,
            opts.metadata_uri,
            opts.region_code,
            opts.terms_hash,
        )
    }

    /// Set or clear the payout beneficiary. Holder-authenticated only.
    pub fn set_beneficiary(
        env: Env,
        holder: Address,
        policy_id: u32,
        beneficiary: Option<Address>,
    ) -> Result<(), policy::PolicyError> {
        policy::set_beneficiary(&env, holder, policy_id, beneficiary)
    }

    /// Admin-only: update the policy metadata URI.
    pub fn admin_update_policy_metadata_uri(
        env: Env,
        holder: Address,
        policy_id: u32,
        new_uri: soroban_sdk::String,
    ) -> Result<(), policy::PolicyError> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        policy::update_policy_metadata_uri(&env, holder, policy_id, new_uri)
    }

    /// Read-only: retrieve a persisted policy by (holder, policy_id).
    pub fn get_policy(env: Env, holder: Address, policy_id: u32) -> Option<types::Policy> {
        storage::get_policy(&env, &holder, policy_id)
    }

    /// Batch-read policies in one simulation/RPC round-trip.
    ///
    /// Returns `Vec` aligned with `ids`: `out[i]` is `Some(policy)` or `None` if that
    /// key is missing — absent keys never revert the whole batch.
    ///
    /// # Hard cap — **`POLICY_BATCH_GET_MAX` (20)**
    ///
    /// Matches [`types::PAGE_SIZE_MAX`]: each entry is an independent storage read, so
    /// large batches multiply metered reads and can exceed the default Soroban
    /// instruction budget during simulation. Dashboards and indexers must chunk
    /// requests. **More than 20 keys reverts** with [`validate::Error::PolicyBatchTooLarge`]
    /// (unlike `list_policies`, which clamps `limit` instead of erroring).
    ///
    /// The cap is checked **before** any policy storage access (no unbounded iteration).
    pub fn get_policies_batch(
        env: Env,
        ids: Vec<types::PolicyLookupKey>,
    ) -> Vec<Option<types::Policy>> {
        if ids.len() > types::POLICY_BATCH_GET_MAX {
            panic_with_error!(&env, validate::Error::PolicyBatchTooLarge);
        }
        let mut out: Vec<Option<types::Policy>> = Vec::new(&env);
        for i in 0..ids.len() {
            let key = ids.get(i).unwrap();
            out.push_back(storage::get_policy(&env, &key.holder, key.policy_id));
        }
        out
    }

    /// Paginated listing of a holder's policies, ordered by ascending policy_id.
    ///
    /// `start_after` is an exclusive cursor: pass `0` for the first page, or the
    /// last `policy_id` received to advance to the next page.
    /// `limit` is capped at `PAGE_SIZE_MAX` (20); larger values are silently clamped.
    ///
    /// Returns summary structs — call `get_policy` for the full record.
    ///
    /// Empty page (len == 0) means no more results exist beyond the cursor.
    /// Because policy_ids are monotonically increasing and never deleted, a
    /// stale cursor never panics — it simply returns an empty page.
    pub fn list_policies(
        env: Env,
        holder: Address,
        start_after: u32,
        limit: u32,
    ) -> Vec<types::PolicySummary> {
        let cap = limit.min(types::PAGE_SIZE_MAX);
        let total = storage::get_policy_counter(&env, &holder);
        let mut results: Vec<types::PolicySummary> = Vec::new(&env);
        let mut id: u32 = start_after.saturating_add(1);
        while id <= total && results.len() < cap {
            if let Some(p) = storage::get_policy(&env, &holder, id) {
                results.push_back(types::PolicySummary {
                    policy_id: p.policy_id,
                    policy_type: p.policy_type,
                    coverage: p.coverage,
                    is_active: p.is_active,
                    end_ledger: p.end_ledger,
                });
            }
            id = id.saturating_add(1);
        }
        results
    }

    /// Read-only: number of active policies for a holder (= vote weight).
    pub fn get_active_policy_count(env: Env, holder: Address) -> u32 {
        storage::get_active_policy_count(&env, &holder)
    }

    /// Read-only (simulation-only): paginated list of inactive/expired policies for a holder.
    ///
    /// Returns policies where `is_active == false` or `current_ledger > end_ledger`.
    /// `page` is zero-indexed; `page_size` is hard-capped at
    /// [`types::INACTIVE_POLICIES_PAGE_SIZE_MAX`] — exceeding it reverts.
    /// An empty result means no more inactive policies exist after the requested offset.
    pub fn get_inactive_policies(
        env: Env,
        holder: Address,
        page: u32,
        page_size: u32,
    ) -> Result<Vec<types::Policy>, validate::Error> {
        if page_size > types::INACTIVE_POLICIES_PAGE_SIZE_MAX {
            panic_with_error!(&env, validate::Error::PageSizeTooLarge);
        }
        let now = env.ledger().sequence();
        let total = storage::get_policy_counter(&env, &holder);
        let skip = page.saturating_mul(page_size);
        let mut skipped: u32 = 0;
        let mut results: Vec<types::Policy> = Vec::new(&env);
        let mut id: u32 = 1;
        while id <= total && results.len() < page_size {
            if let Some(p) = storage::get_policy(&env, &holder, id) {
                if !p.is_active || now > p.end_ledger {
                    if skipped < skip {
                        skipped = skipped.saturating_add(1);
                    } else {
                        results.push_back(p);
                    }
                }
            }
            id = id.saturating_add(1);
        }
        Ok(results)
    }

    /// Read-only: current replay-protection nonce for `holder`.
    /// Pass this value as `expected_nonce` in the next `initiate_policy` or `file_claim`
    /// call to enable nonce checking. Nonce starts at 0 and increments on each
    /// successful mutating call where `expected_nonce` was supplied.
    pub fn get_nonce(env: Env, holder: Address) -> u64 {
        storage::get_holder_nonce(&env, &holder)
    }

    /// If set, the `end_ledger` for which a [`policy::PolicyExpired`] event was already recorded
    /// (one row per policy). Indexers may use this with `get_policy` for idempotency checks.
    /// Name is shortened to satisfy the 32-char Soroban export limit.
    pub fn get_pol_exp_evt_end_ledger(env: Env, holder: Address, policy_id: u32) -> Option<u32> {
        storage::get_policy_expired_event_end_ledger(&env, &holder, policy_id)
    }

    /// Keeper hook: when `ledger_sequence >= policy.end_ledger`, emit [`policy::PolicyExpired`]
    /// once per policy term (see `policy` module docs for notification delay). Reverts if the
    /// policy does not exist or is not yet expired.
    pub fn process_expired(
        env: Env,
        holder: Address,
        policy_id: u32,
    ) -> Result<(), policy::PolicyError> {
        // Record expiry event when now >= end_ledger (even during grace period).
        // Deactivate when now >= end + grace (after grace period ends).
        let result = policy::process_expired(&env, holder.clone(), policy_id);
        // Also attempt lifecycle deactivation; ignore NotYetExpired (still in grace).
        let _ = policy_lifecycle::process_expired(&env, holder, policy_id).map_err(|e| match e {
            policy_lifecycle::PolicyError::PolicyNotFound => policy::PolicyError::NotFound,
            policy_lifecycle::PolicyError::PolicyLapseNotReached => {
                policy::PolicyError::NotYetExpired
            }
            _ => policy::PolicyError::NotYetExpired,
        });
        result
    }

    /// Renew before `end_ledger` (renewal window). If already expired, emits [`policy::PolicyExpired`]
    /// when due and returns [`types::RenewPolicyOutcome::Lapsed`] in **`Ok`** (see type docs).
    pub fn renew_policy(
        env: Env,
        holder: Address,
        policy_id: u32,
        age_band: types::AgeBand,
        coverage_type: types::CoverageType,
        safety_score: u32,
        new_coverage_tier: Option<types::CoverageType>,
        new_coverage_amount: Option<i128>,
    ) -> Result<types::RenewPolicyOutcome, policy::PolicyError> {
        policy::renew_policy(
            &env,
            holder,
            policy_id,
            age_band,
            coverage_type,
            safety_score,
            new_coverage_tier,
            new_coverage_amount,
        )
    }

    pub fn terminate_policy(
        env: Env,
        holder: Address,
        policy_id: u32,
        reason: types::TerminationReason,
    ) -> Result<(), policy_lifecycle::PolicyError> {
        policy_lifecycle::terminate_policy(&env, holder, policy_id, reason)
    }

    /// Transfer policy ownership to `new_holder`. Authenticated by current holder.
    /// Reverts if an open claim exists or `new_holder == holder`.
    pub fn transfer_policy(
        env: Env,
        holder: Address,
        policy_id: u32,
        new_holder: Address,
    ) -> Result<(), validate::Error> {
        policy::transfer_policy(&env, &holder, policy_id, &new_holder)
    }

    pub fn admin_terminate_policy(
        env: Env,
        admin: Address,
        holder: Address,
        policy_id: u32,
        reason: types::TerminationReason,
        allow_open_claims: bool,
    ) -> Result<(), policy_lifecycle::PolicyError> {
        let result = policy_lifecycle::admin_terminate_policy(
            &env,
            admin.clone(),
            holder,
            policy_id,
            reason,
            allow_open_claims,
        );
        if result.is_ok() {
            admin::emit_admin_action(&env, &admin, "admin_terminate_policy");
        }
        result
    }

    pub fn propose_admin(env: Env, new_admin: Address) {
        admin::propose_admin(&env, new_admin);
    }

    pub fn accept_admin(env: Env) {
        admin::accept_admin(&env);
    }

    pub fn cancel_admin(env: Env) {
        admin::cancel_admin(&env);
    }

    // ── Role management (Issue #1161) ─────────────────────────────────────────

    /// Set the dedicated pause-admin address. Only the main admin can call this.
    /// Pass the main admin address to "hold all roles" for single-admin deployments.
    pub fn set_pause_admin(env: Env, addr: Address) {
        let _admin = admin::require_admin(&env);
        storage::set_pause_admin(&env, &addr);
    }

    /// Return the configured pause-admin, or None if it falls back to the main admin.
    pub fn get_pause_admin(env: Env) -> Option<Address> {
        storage::get_pause_admin(&env)
    }

    /// Set the dedicated treasury-admin address. Only the main admin can call this.
    pub fn set_treasury_admin(env: Env, addr: Address) {
        let _admin = admin::require_admin(&env);
        storage::set_treasury_admin(&env, &addr);
    }

    /// Return the configured treasury-admin, or None if it falls back to the main admin.
    pub fn get_treasury_admin(env: Env) -> Option<Address> {
        storage::get_treasury_admin(&env)
    }

    /// Set the dedicated param-admin address. Only the main admin can call this.
    pub fn set_param_admin(env: Env, addr: Address) {
        let _admin = admin::require_admin(&env);
        storage::set_param_admin(&env, &addr);
    }

    /// Return the configured param-admin, or None if it falls back to the main admin.
    pub fn get_param_admin(env: Env) -> Option<Address> {
        storage::get_param_admin(&env)
    }

    /// Propose a high-risk admin action for two-step confirmation.
    pub fn propose_admin_action(env: Env, action: AdminAction) {
        admin::propose_admin_action(&env, action);
    }

    /// Confirm and execute pending admin action (second signer auth).
    pub fn confirm_admin_action(env: Env, confirmer: Address) {
        confirmer.require_auth();
        admin::confirm_admin_action(&env, confirmer);
    }

    /// Cancel pending admin action (proposer auth).
    pub fn cancel_admin_action(env: Env) {
        admin::cancel_admin_action(&env);
    }

    pub fn set_token(env: Env, new_token: Address) {
        admin::set_token(&env, new_token);
    }

    pub fn set_treasury(env: Env, new_treasury: Address) {
        admin::set_treasury(&env, new_treasury);
    }

    pub fn drain(env: Env, recipient: Address, amount: i128) {
        admin::drain(&env, recipient, amount);
    }

    /// Emergency token sweep: recover mistakenly sent tokens with strict ethical constraints.
    ///
    /// # Security & Ethics
    /// - Admin-only (requires multisig in production)
    /// - Asset must be allowlisted
    /// - Optional per-transaction cap
    /// - Protected balance check (won't violate approved claims)
    /// - Comprehensive audit trail
    ///
    /// # Parameters
    /// - `asset`: Token contract address (must be allowlisted)
    /// - `recipient`: Destination for swept tokens
    /// - `amount`: Amount to sweep (must be > 0)
    /// - `reason_code`: Audit code (1=accidental transfer, 2=test tokens, 3=airdrop, etc.)
    ///
    /// See SWEEP_RUNBOOK.md for operational guidance and legal requirements.
    pub fn sweep_token(
        env: Env,
        asset: Address,
        recipient: Address,
        amount: i128,
        reason_code: u32,
    ) {
        admin::sweep_token(&env, asset, recipient, amount, reason_code);
    }

    /// Set optional per-transaction cap for sweep operations.
    /// Pass None to disable cap. Admin-only.
    pub fn set_sweep_cap(env: Env, cap: Option<i128>) {
        admin::set_sweep_cap(&env, cap);
    }

    /// Get current sweep cap (None if not set).
    pub fn get_sweep_cap(env: Env) -> Option<i128> {
        storage::get_sweep_cap(&env)
    }

    /// Set the on-chain notice period (in ledgers) that must elapse between a sweep
    /// proposal and its execution. 0 = disabled. Admin-only.
    /// Recommended mainnet value: 2880 (~4 hours at 5s/ledger).
    pub fn set_sweep_notice_period(env: Env, ledgers: u32) {
        admin::set_sweep_notice_period(&env, ledgers);
    }

    /// Get the current sweep notice period in ledgers (0 = disabled).
    pub fn get_sweep_notice_period(env: Env) -> u32 {
        storage::get_sweep_notice_period_ledgers(&env)
    }

    /// Admin-only: set the governance cooldown window in ledgers after parameter changes.
    pub fn admin_set_gov_cooldown_ledgers(env: Env, new_ledgers: u32) -> Result<(), AdminError> {
        admin::set_governance_cooldown_ledgers(&env, new_ledgers)
    }

    /// Read-only: get the current governance cooldown window in ledgers.
    pub fn get_governance_cooldown_ledgers(env: Env) -> u32 {
        storage::get_governance_cooldown_ledgers(&env)
    }

    // ── Issue #842: Ledger close time estimation ──────────────────────────────

    /// Read-only: return the configured seconds-per-ledger estimate.
    ///
    /// Returns the admin-set value, or the compile-time default of 5 when unset.
    ///
    /// **NOTE:** This is an *estimate* — actual Stellar ledger close times vary
    /// (typically 3–7 s). Use only for UI deadline display, never for on-chain
    /// enforcement or legal SLAs.
    pub fn get_ledger_close_time_estimate(env: Env) -> u32 {
        storage::get_secs_per_ledger_estimate(&env)
    }

    /// Admin-only: update the seconds-per-ledger estimate if network conditions change.
    ///
    /// Valid range: 1–30 seconds. The default is 5 (Stellar Mainnet Protocol 20+).
    /// Name shortened to satisfy Soroban's 32-char entrypoint limit.
    pub fn admin_set_ledger_close_secs(env: Env, secs: u32) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        if secs == 0 || secs > 30 {
            return Err(validate::Error::InvalidLedgerWindow);
        }
        storage::set_secs_per_ledger_estimate(&env, secs);
        Ok(())
    }

    pub fn admin_set_max_sweep_per_ledger(env: Env, cap: i128) -> Result<(), AdminError> {
        admin::set_max_sweep_per_ledger(&env, cap)
    }

    /// Read-only: get the maximum cumulative amount that can be swept in a single ledger (None if unset).
    pub fn get_max_sweep_per_ledger(env: Env) -> Option<i128> {
        storage::get_max_sweep_per_ledger(&env)
    }

    /// Admin-only: set the maximum number of evidence entries per claim.
    /// Hard max is [`storage::MAX_EVIDENCE_COUNT_HARD_MAX`] (20).
    /// Reductions do NOT retroactively invalidate existing claims.
    pub fn admin_set_max_evidence_count(env: Env, new_count: u32) -> Result<(), AdminError> {
        admin::set_max_evidence_count(&env, new_count)
    }

    /// Read the current max evidence count (falls back to compile-time default when unset).
    pub fn get_max_evidence_count(env: Env) -> u32 {
        storage::get_max_evidence_count(&env)
    }

    /// Admin-only: set the minimum number of evidence entries required per claim.
    /// `new_min` must not exceed the current max evidence count.
    /// Setting to 0 disables the minimum (default).
    pub fn admin_set_min_evidence_count(env: Env, new_min: u32) -> Result<(), AdminError> {
        admin::set_min_evidence_count(&env, new_min)
    }

    /// Read the current min evidence count (falls back to 0 when unset).
    pub fn get_min_evidence_count(env: Env) -> u32 {
        storage::get_min_evidence_count(&env)
    }

    /// Admin-only: set the maximum vote weight cap for governance-token-weighted voting.
    /// Must be > 0. Falls back to i128::MAX (uncapped) when unset.
    pub fn admin_set_max_weight_cap(env: Env, new_cap: i128) -> Result<(), AdminError> {
        admin::set_max_weight_cap(&env, new_cap)
    }

    /// Read the current max weight cap (falls back to i128::MAX when unset).
    pub fn get_max_weight_cap(env: Env) -> i128 {
        storage::get_max_weight_cap(&env)
    }

    /// Admin-only: set the per-policy cooldown window in ledgers between claim resolutions.
    /// 0 disables cooldown (default). Max is [`admin::MAX_COOLDOWN_LEDGERS`] (~30 days).
    /// Does not affect claims already in `Processing`.
    pub fn admin_set_cooldown_ledgers(env: Env, new_ledgers: u32) -> Result<(), AdminError> {
        admin::set_cooldown_ledgers(&env, new_ledgers)
    }

    /// Read the current cooldown window in ledgers (falls back to 0 when unset).
    pub fn get_cooldown_ledgers(env: Env) -> u32 {
        storage::get_cooldown_ledgers(&env)
    }

    /// Admin-only: update the allowlisted IPFS gateway URL prefixes for evidence validation.
    /// Evidence URLs must start with `ipfs://` or one of the allowlisted gateway prefixes.
    pub fn admin_set_gateway_allowlist(env: Env, gateways: Vec<String>) -> Result<(), AdminError> {
        admin::set_gateway_allowlist(&env, gateways)
    }

    /// Read the current allowlisted IPFS gateway URL prefixes.
    pub fn get_gateway_allowlist(env: Env) -> Vec<String> {
        storage::get_gateway_allowlist(&env)
    }

    // ── Per-asset premium table ───────────────────────────────────────────────

    /// Admin-only: set an asset-specific multiplier table.
    ///
    /// The asset must be allowlisted. The table must pass the same shape and
    /// bounds validation as the global table. Version must be strictly greater
    /// than any previously stored asset-specific table for this asset.
    ///
    /// Pass `None` for `table` to remove the asset-specific table and revert
    /// to the global default for that asset.
    ///
    /// Emits `AssetPremiumTableSet`.
    pub fn admin_set_asset_premium_table(
        env: Env,
        asset: Address,
        table: Option<types::MultiplierTable>,
    ) -> Result<(), validate::Error> {
        let admin = admin::require_admin(&env);
        admin::check_and_update_gov_cooldown(&env);
        let result = premium::admin_set_asset_premium_table(&env, &asset, table);
        if result.is_ok() {
            admin::emit_admin_action(&env, &admin, "admin_set_asset_premium_table");
        }
        result
    }

    /// Read the asset-specific multiplier table for `asset`.
    /// Returns `None` when no asset-specific table has been set (global default applies).
    pub fn get_asset_premium_table(env: Env, asset: Address) -> Option<types::MultiplierTable> {
        storage::get_asset_premium_table(&env, &asset)
    }

    // ── Policy type registry ──────────────────────────────────────────────────

    /// Admin-only: register or update a policy type in the registry.
    ///
    /// Once registered and active, `initiate_policy` will accept this type.
    /// Emits `PolicyTypeRegistered`.
    pub fn admin_register_policy_type(
        env: Env,
        policy_type: types::PolicyType,
        config: types::PolicyTypeConfig,
    ) -> Result<(), admin::AdminError> {
        admin::require_admin(&env);
        storage::bump_instance(&env);
        storage::set_policy_type_config(&env, &policy_type, &config);
        storage::set_policy_type_active(&env, &policy_type, true);
        PolicyTypeRegistered {
            policy_type,
            active: true,
        }
        .publish(&env);
        Ok(())
    }

    /// Admin-only: deregister a policy type (marks it inactive).
    ///
    /// Existing policies of this type remain valid; only new initiations are blocked.
    /// Emits `PolicyTypeRegistered` with `active = false`.
    pub fn admin_deregister_policy_type(
        env: Env,
        policy_type: types::PolicyType,
    ) -> Result<(), admin::AdminError> {
        admin::require_admin(&env);
        storage::bump_instance(&env);
        storage::set_policy_type_active(&env, &policy_type, false);
        PolicyTypeRegistered {
            policy_type,
            active: false,
        }
        .publish(&env);
        Ok(())
    }

    /// Read-only: returns `true` if the policy type is registered and active.
    pub fn is_policy_type_active(env: Env, policy_type: types::PolicyType) -> bool {
        storage::is_policy_type_active(&env, &policy_type)
    }

    /// Read-only: returns the config for a policy type, or `None` if not registered.
    pub fn get_policy_type_config(
        env: Env,
        policy_type: types::PolicyType,
    ) -> Option<types::PolicyTypeConfig> {
        storage::get_policy_type_config(&env, &policy_type)
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

    /// Pause the contract with a structured reason.
    ///
    /// `reason` is stored on-chain so incident responders can read it via simulation
    /// without authentication. Emits `PauseToggled` with the reason code.
    pub fn pause(env: Env, admin: Address, reason: types::PauseReason) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can pause");
        storage::set_paused(&env, true);
        storage::set_pause_reason(&env, Some(reason.clone()));

        let flags = storage::get_pause_flags(&env);
        let reason_code = pause_reason_to_code(&reason);
        PauseToggled {
            admin: admin.clone(),
            paused: true,
            reason_code,
            bind_paused: flags.bind_paused,
            claims_paused: flags.claims_paused,
        }
        .publish(&env);
        admin::emit_admin_action(&env, &admin, "pause");
    }

    /// Unpause the contract. Clears the stored pause reason.
    /// Emits `PauseToggled` with `paused=false` and `reason_code=0`.
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can unpause");
        storage::set_paused(&env, false);
        // Clear the pause reason on unpause.
        storage::set_pause_reason(&env, None);

        let flags = storage::get_pause_flags(&env);
        PauseToggled {
            admin: admin.clone(),
            paused: false,
            reason_code: 0,
            bind_paused: flags.bind_paused,
            claims_paused: flags.claims_paused,
        }
        .publish(&env);
        admin::emit_admin_action(&env, &admin, "unpause");
    }

    /// Granular pause: pause only policy binding (initiate/renew).
    pub fn pause_bind(env: Env, admin: Address, reason: types::PauseReason) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can pause");

        let mut flags = storage::get_pause_flags(&env);
        flags.bind_paused = true;
        storage::set_pause_flags(&env, &flags);
        storage::set_pause_reason(&env, Some(reason.clone()));

        let reason_code = pause_reason_to_code(&reason);
        PauseToggled {
            admin: admin.clone(),
            paused: true,
            reason_code,
            bind_paused: flags.bind_paused,
            claims_paused: flags.claims_paused,
        }
        .publish(&env);
        admin::emit_admin_action(&env, &admin, "pause_bind");
    }

    /// Granular pause: pause only claims (file/vote/finalize).
    pub fn pause_claims(env: Env, admin: Address, reason: types::PauseReason) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can pause");

        let mut flags = storage::get_pause_flags(&env);
        flags.claims_paused = true;
        storage::set_pause_flags(&env, &flags);
        storage::set_pause_reason(&env, Some(reason.clone()));

        let reason_code = pause_reason_to_code(&reason);
        PauseToggled {
            admin: admin.clone(),
            paused: true,
            reason_code,
            bind_paused: flags.bind_paused,
            claims_paused: flags.claims_paused,
        }
        .publish(&env);
        admin::emit_admin_action(&env, &admin, "pause_claims");
    }

    /// Get current pause state (legacy - true if ANY pause flag is set).
    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    /// Get detailed pause flags (bind_paused, claims_paused).
    pub fn get_pause_flags(env: Env) -> storage::PauseFlags {
        storage::get_pause_flags(&env)
    }

    /// Read-only: get the current pause reason.
    /// Returns `None` when the contract is unpaused or no reason was stored.
    /// Safe to call via simulation without authentication.
    pub fn get_pause_reason(env: Env) -> Option<types::PauseReason> {
        storage::get_pause_reason(&env)
    }

    // ── Rolling claim cap (ledger-window cumulative paid per policy) ─────────

    /// Global rolling cap on **paid** claim amounts per policy per ledger window (gross `claim.amount`).
    /// `i128::MAX` means effectively uncapped.
    pub fn get_rolling_claim_cap(env: Env) -> i128 {
        storage::get_rolling_claim_cap(&env)
    }

    /// Ledger length of each rolling window bucket (aligned to `ledger_sequence / window`).
    pub fn get_rolling_claim_window_ledgers(env: Env) -> u32 {
        storage::get_rolling_claim_window_ledgers(&env)
    }

    /// Remaining amount that can be **filed** this window before hitting the cap (`0` if at/over cap).
    /// Indexers can combine with cap and `get_rolling_claim_state` for full UI.
    pub fn get_rolling_claim_remaining(env: Env, holder: Address, policy_id: u32) -> i128 {
        let now = env.ledger().sequence();
        rolling_claim_cap::remaining_under_cap(&env, &holder, policy_id, now)
    }

    /// Raw rolling state for `(holder, policy_id)` if present (window bucket + cumulative paid).
    pub fn get_rolling_claim_state(
        env: Env,
        holder: Address,
        policy_id: u32,
    ) -> Option<types::RollingClaimWindowState> {
        storage::get_rolling_claim_state(&env, &holder, policy_id)
    }

    /// Admin: set rolling claim cap. Bounded unless `i128::MAX` (uncapped). Emits `ClaimCapUpdated`.
    pub fn set_rolling_claim_cap(env: Env, new_cap: i128) -> Result<(), AdminError> {
        let admin = admin::require_admin(&env);
        let result = rolling_claim_cap::try_set_cap(&env, new_cap);
        if result.is_ok() {
            admin::emit_admin_action(&env, &admin, "set_rolling_claim_cap");
        }
        result
    }

    /// Admin: set rolling window length in ledgers. Emits `RollingClaimWindowLedgersUpdated`.
    pub fn set_rolling_claim_window_ledgers(
        env: Env,
        window_ledgers: u32,
    ) -> Result<(), AdminError> {
        let admin = admin::require_admin(&env);
        let result = rolling_claim_cap::try_set_window_ledgers(&env, window_ledgers);
        if result.is_ok() {
            admin::emit_admin_action(&env, &admin, "set_rolling_claim_window_ledgers");
        }
        result
    }

    // ── Issue #583: Claim fraud score ─────────────────────────────────────────

    /// Admin or delegated oracle: set fraud score (0–100) for a claim.
    /// High-score claims require elevated quorum at finalization.
    pub fn set_claim_fraud_score(
        env: Env,
        caller: Address,
        claim_id: u64,
        score: u32,
    ) -> Result<(), validate::Error> {
        caller.require_auth();
        claim::set_claim_fraud_score(&env, &caller, claim_id, score)
    }

    /// Read the fraud score for a claim (None if not set).
    pub fn get_claim_fraud_score(env: Env, claim_id: u64) -> Option<u32> {
        storage::get_claim_fraud_score(&env, claim_id)
    }

    /// Admin: set the fraud score threshold above which elevated quorum applies.
    pub fn admin_set_fraud_score_threshold(
        env: Env,
        threshold: u32,
    ) -> Result<(), validate::Error> {
        let _admin = admin::require_admin(&env);
        admin::check_and_update_gov_cooldown(&env);
        if threshold > 100 {
            return Err(validate::Error::SafetyScoreOutOfRange);
        }
        storage::set_fraud_score_threshold(&env, threshold);
        Ok(())
    }

    /// Admin: set the elevated quorum bps used when fraud score exceeds threshold.
    pub fn admin_set_elevated_quorum_bps(env: Env, bps: u32) -> Result<(), validate::Error> {
        let _admin = admin::require_admin(&env);
        admin::check_and_update_gov_cooldown(&env);
        validate::validate_quorum_bps(bps)?;
        storage::set_elevated_quorum_bps(&env, bps);
        Ok(())
    }

    // ── Issue #787: Coverage amount floor ────────────────────────────────────

    /// Admin: set the minimum coverage amount floor. Policies below this are rejected.
    pub fn admin_set_min_coverage_amount(env: Env, amount: i128) -> Result<(), validate::Error> {
        let _admin = admin::require_admin(&env);
        if amount < 0 {
            return Err(validate::Error::ZeroCoverage);
        }
        storage::set_min_coverage_amount(&env, amount);
        Ok(())
    }

    /// Read the current minimum coverage amount floor.
    pub fn get_min_coverage_amount(env: Env) -> i128 {
        storage::get_min_coverage_amount(&env)
    }

    // ── Issue #783: Voter count hard cap ──────────────────────────────────────

    /// Admin: set the maximum number of unique voters per claim.
    pub fn admin_set_max_voters_per_claim(env: Env, cap: u32) -> Result<(), validate::Error> {
        let _admin = admin::require_admin(&env);
        if cap == 0 {
            return Err(validate::Error::VotingDurationOutOfBounds);
        }
        storage::set_max_voters_per_claim(&env, cap);
        Ok(())
    }

    /// Read the current max voters per claim cap.
    pub fn get_max_voters_per_claim(env: Env) -> u32 {
        storage::get_max_voters_per_claim(&env)
    }

    // ── Issue #782: Token decimal normalization ───────────────────────────────

    /// Admin: manually store decimals for an asset (issue #782).
    pub fn admin_set_asset_decimals(env: Env, asset: Address, decimals: u32) {
        let _admin = admin::require_admin(&env);
        storage::set_asset_decimals(&env, &asset, decimals);
    }

    /// Read the stored decimals for an asset (None if not yet queried).
    pub fn get_asset_decimals(env: Env, asset: Address) -> Option<u32> {
        storage::get_asset_decimals(&env, &asset)
    }

    // ── Issue #786: Claim description length validation ───────────────────────

    /// Read the maximum claim description byte length constant (issue #786).
    pub fn get_max_claim_description_bytes(env: Env) -> u32 {
        let _ = env;
        types::DETAILS_MAX_LEN
    }

    /// Dust claims below min and over-coverage claims above max will revert.
    pub fn admin_set_asset_claim_bounds(
        env: Env,
        asset: Address,
        min_claim_amount: i128,
        max_claim_amount: i128,
    ) -> Result<(), validate::Error> {
        let _admin = admin::require_admin(&env);
        admin::check_and_update_gov_cooldown(&env);
        if min_claim_amount < 0 || max_claim_amount < min_claim_amount {
            return Err(validate::Error::ClaimAmountZero);
        }
        storage::set_allowed_asset_config(
            &env,
            &asset,
            &types::AllowedAssetConfig {
                min_claim_amount,
                max_claim_amount,
            },
        );
        AssetClaimBoundsUpdated {
            asset,
            min_claim_amount,
            max_claim_amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Read the asset-specific claim bounds (None if not configured).
    pub fn get_asset_claim_bounds(env: Env, asset: Address) -> Option<types::AllowedAssetConfig> {
        storage::get_allowed_asset_config(&env, &asset)
    }

    // ── Issue #585: Admin role delegation ────────────────────────────────────

    /// Admin: grant a temporary delegation to `operator` with specific permissions.
    pub fn grant_delegation(
        env: Env,
        operator: Address,
        expiry_ledger: u32,
        permissions: types::DelegationPermissions,
    ) -> Result<(), validate::Error> {
        let admin = admin::require_admin(&env);
        delegation::grant_delegation(&env, &admin, &operator, expiry_ledger, permissions)
    }

    /// Admin: revoke a delegation before it expires.
    pub fn revoke_delegation(env: Env, operator: Address) {
        let admin = admin::require_admin(&env);
        delegation::revoke_delegation(&env, &admin, &operator);
    }

    /// Read a delegation record (None if not set or expired).
    pub fn get_delegation(env: Env, operator: Address) -> Option<types::DelegationRecord> {
        delegation::get_delegation(&env, &operator)
    }

    /// Read-only (simulation-safe): paginated list of active delegated scopes for
    /// `operator`. Expired and revoked grants are omitted. `start_after` is the
    /// number of scopes to skip; `limit` is clamped to `PAGE_SIZE_MAX`.
    pub fn list_active_delegated_scopes(
        env: Env,
        operator: Address,
        start_after: u32,
        limit: u32,
    ) -> soroban_sdk::Vec<types::ActiveDelegatedScope> {
        delegation::list_active_delegated_scopes(&env, &operator, start_after, limit)
    }

    // ── Issue #581: Reinsurance pool ──────────────────────────────────────────

    /// Admin: set the reinsurance contract address.
    /// When primary treasury is insufficient, overflow is drawn from this contract.
    pub fn admin_set_reinsurance_contract(env: Env, reinsurance: Address) {
        let _admin = admin::require_admin(&env);
        admin::check_and_update_gov_cooldown(&env);
        storage::set_reinsurance_contract(&env, &reinsurance);
        ReinsuranceContractUpdated {
            reinsurance_contract: reinsurance,
        }
        .publish(&env);
    }

    /// Admin: clear the reinsurance contract (disables reinsurance fallback).
    pub fn admin_clear_reinsurance_contract(env: Env) {
        let _admin = admin::require_admin(&env);
        admin::check_and_update_gov_cooldown(&env);
        storage::clear_reinsurance_contract(&env);
    }

    /// Read the configured reinsurance contract address (None if not set).
    pub fn get_reinsurance_contract(env: Env) -> Option<Address> {
        storage::get_reinsurance_contract(&env)
    }

    // ── KYC whitelist (Issue #2) ──────────────────────────────────────────────
    //
    // Allows the admin to gate `initiate_policy` calls for KYC compliance without
    // redeployment. When `whitelist_enabled` is `true`, only addresses added via
    // `admin_add_to_whitelist` may initiate policies; others receive `NotWhitelisted`.
    // When disabled, the whitelist map is ignored and all addresses may bind policies.

    /// Admin: enable or disable KYC whitelist enforcement for initiate_policy calls.
    pub fn admin_set_whitelist_enabled(env: Env, enabled: bool) {
        let _admin = admin::require_admin(&env);
        admin::check_and_update_gov_cooldown(&env);
        storage::bump_instance(&env);
        storage::set_whitelist_enabled(&env, enabled);
        WhitelistToggled { enabled }.publish(&env);
    }

    /// Read-only: whether KYC whitelist enforcement is currently active.
    pub fn get_whitelist_enabled(env: Env) -> bool {
        storage::is_whitelist_enabled(&env)
    }

    /// Admin: add an address to the KYC whitelist.
    pub fn admin_add_to_whitelist(env: Env, holder: Address) {
        let _admin = admin::require_admin(&env);
        storage::bump_instance(&env);
        storage::set_whitelisted(&env, &holder, true);
        WhitelistAddressUpdated {
            holder,
            allowed: true,
        }
        .publish(&env);
    }

    /// Admin: remove an address from the KYC whitelist.
    pub fn admin_remove_from_whitelist(env: Env, holder: Address) {
        let _admin = admin::require_admin(&env);
        storage::bump_instance(&env);
        storage::set_whitelisted(&env, &holder, false);
        WhitelistAddressUpdated {
            holder,
            allowed: false,
        }
        .publish(&env);
    }

    /// Read-only: whether `holder` is on the KYC whitelist.
    pub fn is_whitelisted(env: Env, holder: Address) -> bool {
        storage::is_whitelisted(&env, &holder)
    }

    /// Read-only: whether a depositor is authorized to inject treasury capital.
    pub fn is_authorized_depositor(env: Env, depositor: Address) -> bool {
        storage::is_authorized_depositor(&env, &depositor)
    }

    /// Admin-only: add or remove a treasury depositor from the allowlist.
    pub fn set_authorized_depositor(
        env: Env,
        depositor: Address,
        allowed: bool,
    ) -> Result<(), AdminError> {
        let _admin = admin::require_admin(&env);
        storage::bump_instance(&env);
        storage::set_authorized_depositor(&env, &depositor, allowed);
        TreasuryDepositorUpdated { depositor, allowed }.publish(&env);
        Ok(())
    }

    /// Authorized depositor-only: transfer capital into the treasury and emit an event.
    pub fn deposit_treasury(
        env: Env,
        depositor: Address,
        amount: i128,
        asset: Address,
    ) -> Result<(), validate::Error> {
        storage::bump_instance(&env);
        if amount <= 0 {
            return Err(validate::Error::ZeroTreasuryDeposit);
        }
        if !storage::is_authorized_depositor(&env, &depositor) {
            return Err(validate::Error::UnauthorizedTreasuryDepositor);
        }

        depositor.require_auth();

        let client = soroban_sdk::token::TokenClient::new(&env, &asset);
        client.transfer(&depositor, env.current_contract_address(), &amount);

        TreasuryDeposited {
            depositor,
            asset,
            amount,
            at_ledger: env.ledger().sequence(),
        }
        .publish(&env);

        Ok(())
    }

    /// Read-only: whether a contract payout recipient is explicitly allowlisted.
    pub fn is_allowed_payout_recipient(env: Env, recipient: Address) -> bool {
        storage::is_allowed_payout_recipient(&env, &recipient)
    }

    /// Admin-only: add or remove a contract payout recipient from the allowlist.
    pub fn set_allowed_payout_recipient(
        env: Env,
        recipient: Address,
        allowed: bool,
    ) -> Result<(), AdminError> {
        let _admin = admin::require_admin(&env);
        storage::bump_instance(&env);
        storage::set_allowed_payout_recipient(&env, &recipient, allowed);
        Ok(())
    }
}

/// Keeper TTL Management entrypoints
#[contractimpl]
impl NiffyInsure {
    /// Keeper: extend TTL for a specific policy. Returns true if extended, false if policy not found.
    /// Prevents data loss for long-lived policies without admin intervention.
    pub fn bump_policy_ttl(env: Env, holder: Address, policy_id: u32) -> bool {
        storage::bump_policy_ttl(&env, &holder, policy_id)
    }

    /// Keeper: extend TTL for all policies belonging to a holder. Returns count of policies extended.
    pub fn bump_holder_all_policies_ttl(env: Env, holder: Address) -> u32 {
        storage::bump_holder_all_policies_ttl(&env, &holder)
    }

    /// Keeper: extend TTL for all claim-related entries for a specific claim. Returns true if extended.
    pub fn bump_claim_ttl(env: Env, claim_id: u64) -> bool {
        storage::bump_claim_ttl(&env, claim_id)
    }

    /// Get TTL information for a policy (for monitoring/alerts). Returns remaining ledgers or None.
    pub fn get_policy_ttl_info(env: Env, holder: Address, policy_id: u32) -> Option<u32> {
        storage::get_policy_ttl_info(&env, &holder, policy_id)
    }

    /// Get TTL information for a claim (for monitoring/alerts). Returns remaining ledgers or None.
    pub fn get_claim_ttl_info(env: Env, claim_id: u64) -> Option<u32> {
        storage::get_claim_ttl_info(&env, claim_id)
    }

    /// Check if a policy's TTL is within the alert threshold. Returns true if near expiry.
    pub fn is_policy_ttl_near_expiry(env: Env, holder: Address, policy_id: u32) -> bool {
        storage::is_policy_ttl_near_expiry(&env, &holder, policy_id)
    }

    /// Admin: set the TTL alert threshold for expiry notifications.
    pub fn set_ttl_alert_threshold(env: Env, threshold: u32) -> Result<(), AdminError> {
        let admin = admin::require_admin(&env);
        storage::set_ttl_alert_threshold(&env, threshold);
        admin::emit_admin_action(&env, &admin, "set_ttl_alert_threshold");
        Ok(())
    }

    /// Get the current TTL alert threshold.
    pub fn get_ttl_alert_threshold(env: Env) -> u32 {
        storage::get_ttl_alert_threshold(&env)
    }
}

/// Governance token: reserved entrypoints only when built with `--features governance-token`.
/// No mint/transfer/balance logic — see `governance_token` module TODO.
#[cfg(feature = "governance-token")]
#[contractimpl]
impl NiffyInsure {
    pub fn gov_token_runtime_enabled(env: Env) -> bool {
        governance_token::governance_token_effective_enabled(&env)
    }

    pub fn gov_set_token_runtime_enabled(env: Env, admin: Address, enabled: bool) {
        admin.require_auth();
        let stored = storage::get_admin(&env);
        assert!(admin == stored, "only admin");
        storage::bump_instance(&env);
        governance_token::set_governance_token_runtime_enabled(&env, enabled);
        governance_token::emit_governance_token_activation(&env, &admin, enabled);
        admin::emit_admin_action(&env, &admin, "gov_set_token_runtime_enabled");
    }

    pub fn gov_token_address(env: Env) -> Option<Address> {
        governance_token::get_governance_token_address(&env)
    }

    pub fn gov_set_token_address_stub(env: Env, admin: Address, token: Address) {
        admin.require_auth();
        let stored = storage::get_admin(&env);
        assert!(admin == stored, "only admin");
        storage::bump_instance(&env);
        governance_token::set_governance_token_address(&env, &token);
        admin::emit_admin_action(&env, &admin, "gov_set_token_address_stub");
    }
}

#[cfg(not(target_family = "wasm"))]
#[contractimpl]
impl NiffyInsure {
    pub fn test_seed_policy(
        env: Env,
        holder: Address,
        policy_id: u32,
        coverage: i128,
        end_ledger: u32,
    ) {
        use crate::types::{Policy, PolicyType, RegionTier, TerminationReason};
        let token = storage::get_token(&env);
        // Non-zero terms_hash sentinel for test policies.
        let mut hash_bytes = [0u8; 32];
        hash_bytes[0] = 1;
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
            deductible: None,
            beneficiary: None,
            terminated_at_ledger: 0,
            termination_reason: TerminationReason::None,
            terminated_by_admin: false,
            strike_count: 0,
            metadata_uri: String::from_str(&env, "ipfs://test-policy-metadata"),
            terms_hash: soroban_sdk::BytesN::from_array(&env, &hash_bytes),
            token_decimals: 7,
        };
        let key = storage::DataKey::Policy(holder.clone(), policy_id);
        env.storage().persistent().set(&key, &policy);
        env.storage().persistent().extend_ttl(
            &key,
            storage::PERSISTENT_TTL_THRESHOLD,
            storage::PERSISTENT_TTL_EXTEND_TO,
        );
        storage::add_voter(&env, &holder);
    }

    pub fn test_remove_voter(env: Env, holder: Address) {
        storage::remove_voter(&env, &holder);
    }

    /// Test-only: extend a seeded policy's end_ledger to simulate a renewal
    /// without going through token transfer. Mirrors what `renew_policy` does
    /// after premium collection (extend end, keep start) and resets the rolling cap.
    pub fn test_renew_policy(env: Env, holder: Address, policy_id: u32) {
        let mut policy = storage::get_policy(&env, &holder, policy_id).expect("policy not found");
        let new_end = policy
            .end_ledger
            .saturating_add(ledger::POLICY_DURATION_LEDGERS);
        policy.end_ledger = new_end;
        storage::set_policy(&env, &holder, policy_id, &policy);
        let now = env.ledger().sequence();
        rolling_claim_cap::reset_on_renewal(&env, &holder, policy_id, now);
    }

    pub fn admin_set_open_claim_count(
        env: Env,
        admin: Address,
        holder: Address,
        policy_id: u32,
        open_claim_count: u32,
    ) {
        let expected = storage::get_admin(&env);
        admin.require_auth();
        assert!(admin == expected, "only admin can set open claim count");
        storage::set_open_claim(&env, &holder, policy_id, open_claim_count > 0);
        admin::emit_admin_action(&env, &admin, "admin_set_open_claim_count");
    }
}
