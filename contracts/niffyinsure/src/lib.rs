#![no_std]
#![allow(clippy::too_many_arguments)]

pub mod admin;
pub mod events;
mod calculator;
mod claim;
mod governance_token;
mod ledger;
mod rolling_claim_cap;
mod policy;
mod policy_lifecycle;
pub mod premium;
pub mod premium_pure;
pub mod storage;
mod token;
pub mod types;
pub mod validate;

#[cfg(feature = "experimental")]
mod oracle;
#[cfg(feature = "experimental")]
pub use oracle::*;

use soroban_sdk::{contract, contractevent, contractimpl, panic_with_error, Address, Env, Vec};

#[contract]
pub struct NiffyInsure;
pub use admin::{AdminAction, AdminError, PendingAdminAction};
pub use policy::RenewalError;
pub use policy_lifecycle::PolicyError;

#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[soroban_sdk::contracterror]
#[repr(u32)]
pub enum InitError {
    AlreadyInitialized = 1,
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

#[contractevent(topics = ["niffyinsure", "quorum_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct QuorumUpdated {
    pub old_bps: u32,
    pub new_bps: u32,
}

#[contractevent(topics = ["niffyinsure", "pause_toggled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct PauseToggled {
    #[topic]
    pub admin: Address,
    pub paused: bool,
    pub reason_code: u32,
    pub bind_paused: bool,
    pub claims_paused: bool,
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
        storage::set_voting_duration_ledgers(&env, ledger::VOTE_WINDOW_LEDGERS);
        storage::set_quorum_bps(&env, types::DEFAULT_QUORUM_BPS);
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

    /// Read-only: balance of the default payout token held by this contract (payout reserve).
    /// Matches funds available for `process_claim` for the configured default asset.
    pub fn get_treasury_balance(env: Env) -> i128 {
        let token_addr = storage::get_token(&env);
        crate::token::get_balance(&env, &token_addr)
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
    pub fn set_allowed_asset(env: Env, asset: Address, allowed: bool) {
        let _admin = admin::require_admin(&env);
        storage::bump_instance(&env);
        claim::set_allowed_asset(&env, &asset, allowed);
        AllowedAssetUpdated { asset, allowed }.publish(&env);
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
        claim::file_claim(&env, &holder, policy_id, amount, &details, &evidence, expected_nonce)
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

    pub fn vote_on_claim(
        env: Env,
        voter: Address,
        claim_id: u64,
        vote: types::VoteOption,
    ) -> Result<types::ClaimStatus, validate::Error> {
        voter.require_auth();
        claim::vote_on_claim(&env, &voter, claim_id, &vote)
    }

    /// Permissionless keeper hook: bump persistent TTL for the claim voter snapshot.
    /// Does not alter eligibility or tallies.
    pub fn refresh_snapshot(env: Env, claim_id: u64) -> Result<(), validate::Error> {
        claim::refresh_snapshot(&env, claim_id)
    }

    pub fn finalize_claim(env: Env, claim_id: u64) -> Result<types::ClaimStatus, validate::Error> {
        claim::finalize_claim(&env, claim_id)
    }

    /// Permissionless keeper: deactivate policy after `end_ledger + grace_period_ledgers`.
    /// `holder` identifies the policy record (no authentication).
    pub fn process_expired(
        env: Env,
        holder: Address,
        policy_id: u32,
    ) -> Result<(), policy_lifecycle::PolicyError> {
        policy_lifecycle::process_expired(&env, holder, policy_id)
    }

    /// Permissionless keeper: finalize claim when past `voting_deadline_ledger` (same rules as `finalize_claim`).
    pub fn process_deadline(
        env: Env,
        claim_id: u64,
    ) -> Result<types::ClaimStatus, validate::Error> {
        claim::process_deadline(&env, claim_id)
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

    pub fn admin_set_vote_duration_ledgers(
        env: Env,
        ledgers: u32,
    ) -> Result<(), validate::Error> {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        ledger::validate_voting_duration_ledgers(ledgers)?;
        storage::set_voting_duration_ledgers(&env, ledgers);
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
        validate::validate_quorum_bps(quorum_bps)?;
        let old = storage::get_quorum_bps(&env);
        storage::set_quorum_bps(&env, quorum_bps);
        QuorumUpdated {
            old_bps: old,
            new_bps: quorum_bps,
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

    // ── Renewal ───────────────────────────────────────────────────────────────

    /// Renew an existing active policy within the standard or grace window.
    pub fn renew_policy(
        env: Env,
        holder: Address,
        policy_id: u32,
        age_band: types::AgeBand,
        coverage_type: types::CoverageTier,
        safety_score: u32,
        base_amount: i128,
    ) -> Result<types::Policy, policy::RenewalError> {
        storage::bump_instance(&env);
        policy::renew_policy(
            &env,
            holder,
            policy_id,
            age_band,
            coverage_type,
            safety_score,
            base_amount,
        )
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
    pub fn list_claims(
        env: Env,
        start_after: u64,
        limit: u32,
    ) -> Vec<types::ClaimSummary> {
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

    pub fn get_policy_counter(env: Env, holder: Address) -> u32 {
        storage::get_policy_counter(&env, &holder)
    }

    pub fn has_policy(env: Env, holder: Address, policy_id: u32) -> bool {
        storage::has_policy(&env, &holder, policy_id)
    }

    pub fn get_voters(env: Env) -> Vec<Address> {
        storage::get_voters(&env)
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
        storage::set_calc_address(&env, &calculator);
    }

    pub fn clear_calculator(env: Env) {
        let admin = storage::get_admin(&env);
        admin.require_auth();
        env.storage()
            .instance()
            .remove(&storage::DataKey::CalcAddress);
    }

    pub fn get_calculator(env: Env) -> Option<Address> {
        storage::get_calc_address(&env)
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
    pub fn get_pol_exp_evt_end_ledger(
        env: Env,
        holder: Address,
        policy_id: u32,
    ) -> Option<u32> {
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
        policy::process_expired(&env, holder, policy_id)
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
    ) -> Result<types::RenewPolicyOutcome, policy::PolicyError> {
        policy::renew_policy(
            &env,
            holder,
            policy_id,
            age_band,
            coverage_type,
            safety_score,
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

    pub fn admin_terminate_policy(
        env: Env,
        admin: Address,
        holder: Address,
        policy_id: u32,
        reason: types::TerminationReason,
        allow_open_claims: bool,
    ) -> Result<(), policy_lifecycle::PolicyError> {
        policy_lifecycle::admin_terminate_policy(
            &env,
            admin,
            holder,
            policy_id,
            reason,
            allow_open_claims,
        )
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

    /// Propose a high-risk admin action for two-step confirmation.
    pub fn propose_admin_action(env: Env, action: AdminAction) {
        admin::propose_admin_action(&env, action);
    }

    /// Confirm and execute pending admin action (second signer auth).
    pub fn confirm_admin_action(env: Env) {
        admin::confirm_admin_action(&env);
    }

    /// Cancel pending admin action (proposer auth).
    pub fn cancel_admin_action(env: Env) {
        admin::cancel_admin_action(&env);
    }

pub fn set_token(env: Env, new_token: Address) {
        admin::set_token(&env, new_token);
    }

    /// *** DEPRECATED single-step *** Use propose_admin_action(TreasuryRotation) for protected rotation.
    pub fn set_treasury(env: Env, new_treasury: Address) {
        admin::set_treasury(&env, new_treasury);
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

        let flags = storage::get_pause_flags(&env);
        PauseToggled {
            admin,
            paused: true,
            reason_code,
            bind_paused: flags.bind_paused,
            claims_paused: flags.claims_paused,
        }
        .publish(&env);
    }

    /// Unpause the contract with optional reason code.
    /// Reason codes: 0=resolved, 1=manual, 2=other
    /// Emits PauseToggled event with admin, paused=false, and reason code.
    pub fn unpause(env: Env, admin: Address, reason_code: u32) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can unpause");
        storage::set_paused(&env, false);

        let flags = storage::get_pause_flags(&env);
        PauseToggled {
            admin,
            paused: false,
            reason_code,
            bind_paused: flags.bind_paused,
            claims_paused: flags.claims_paused,
        }
        .publish(&env);
    }

    /// Granular pause: pause only policy binding (initiate/renew).
    pub fn pause_bind(env: Env, admin: Address, reason_code: u32) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can pause");

        let mut flags = storage::get_pause_flags(&env);
        flags.bind_paused = true;
        storage::set_pause_flags(&env, &flags);

        PauseToggled {
            admin,
            paused: true,
            reason_code,
            bind_paused: flags.bind_paused,
            claims_paused: flags.claims_paused,
        }
        .publish(&env);
    }

    /// Granular pause: pause only claims (file/vote/finalize).
    pub fn pause_claims(env: Env, admin: Address, reason_code: u32) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        assert!(admin == stored_admin, "only admin can pause");

        let mut flags = storage::get_pause_flags(&env);
        flags.claims_paused = true;
        storage::set_pause_flags(&env, &flags);

        PauseToggled {
            admin,
            paused: true,
            reason_code,
            bind_paused: flags.bind_paused,
            claims_paused: flags.claims_paused,
        }
        .publish(&env);
    }

    /// Get current pause state (legacy - true if ANY pause flag is set).
    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    /// Get detailed pause flags (bind_paused, claims_paused).
    pub fn get_pause_flags(env: Env) -> storage::PauseFlags {
        storage::get_pause_flags(&env)
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
    pub fn get_rolling_claim_remaining(
        env: Env,
        holder: Address,
        policy_id: u32,
    ) -> i128 {
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
        let _admin = admin::require_admin(&env);
        rolling_claim_cap::try_set_cap(&env, new_cap)
    }

    /// Admin: set rolling window length in ledgers. Emits `RollingClaimWindowLedgersUpdated`.
    pub fn set_rolling_claim_window_ledgers(env: Env, window_ledgers: u32) -> Result<(), AdminError> {
        let _admin = admin::require_admin(&env);
        rolling_claim_cap::try_set_window_ledgers(&env, window_ledgers)
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
        };
        env.storage().persistent().set(
            &storage::DataKey::Policy(holder.clone(), policy_id),
            &policy,
        );
        storage::add_voter(&env, &holder);
    }

    pub fn test_remove_voter(env: Env, holder: Address) {
        storage::remove_voter(&env, &holder);
    }

    /// Test-only: advance a seeded policy's end_ledger to simulate a renewal
    /// without going through token transfer. Mirrors what renew_policy does
    /// to the policy record after premium collection.
    pub fn test_renew_policy(env: Env, holder: Address, policy_id: u32) {
        let mut policy = storage::get_policy(&env, &holder, policy_id)
            .expect("policy not found");
        let new_start = policy.end_ledger.saturating_add(1);
        let new_end = new_start + ledger::POLICY_DURATION_LEDGERS;
        policy.start_ledger = new_start;
        policy.end_ledger = new_end;
        storage::set_policy(&env, &holder, policy_id, &policy);
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
    }
}
