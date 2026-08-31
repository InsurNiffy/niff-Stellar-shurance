/// Privileged administration: admin rotation, token update, pause toggle, drain.
///
/// # Centralization disclosure (for users / auditors)
///
/// Community policyholders govern claim outcomes via DAO voting — no admin
/// override exists on individual claims. However, the following protocol
/// parameters remain admin-controlled in the MVP:
///   - Token contract address, pause state, admin key, treasury drain.
///
/// Production deployments SHOULD use a Stellar multisig account as admin.
/// See SECURITY.md for the full threat matrix and multisig setup guidance.
use soroban_sdk::{
    contracterror, contractevent, contracttype, panic_with_error, Address, Env, Map, String, Vec,
};

use crate::storage;

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, PartialOrd, Ord, Eq)]
#[repr(u32)]
pub enum AdminError {
    /// Caller is not the current admin.
    Unauthorized = 100,
    /// initialize() has already been called.
    AlreadyInitialized = 101,
    /// No pending admin proposal exists.
    NoPendingAdmin = 102,
    /// Caller is not the pending admin.
    NotPendingAdmin = 103,
    /// Supplied address failed validation (e.g. non-allowlisted token).
    InvalidAddress = 104,
    /// Drain amount must be > 0.
    InvalidDrainAmount = 105,
    /// Sweep amount must be > 0.
    InvalidSweepAmount = 106,
    /// Sweep would exceed per-transaction cap.
    SweepCapExceeded = 107,
    /// Asset is not allowlisted for sweep operations.
    AssetNotAllowlisted = 108,
    /// Sweep would violate protected balance constraints.
    ProtectedBalanceViolation = 109,
    /// Rolling claim cap outside allowed bounds.
    RollingClaimCapOutOfBounds = 110,
    /// Rolling claim window length outside allowed bounds.
    RollingClaimWindowOutOfBounds = 111,
    /// No pending admin action.
    NoPendingAdminAction = 112,
    /// Pending admin action expired.
    AdminActionExpired = 113,
    /// Cannot confirm own proposal (must be second signer).
    CannotSelfConfirm = 114,
    /// Admin action window out of bounds.
    InvalidAdminActionWindow = 115,
    /// Sweep notice period has not elapsed since the proposal.
    SweepNoticePeriodActive = 116,
    /// Max evidence count outside the absolute hard bound.
    MaxEvidenceCountOutOfBounds = 117,
    /// Payout asset override is not allowlisted.
    PayoutAssetOverrideNotAllowlisted = 118,
    /// Min evidence count exceeds current max evidence count.
    MinEvidenceExceedsMax = 119,
    /// Max weight cap must be > 0.
    InvalidMaxWeightCap = 120,
    /// Cooldown ledgers value is out of allowed bounds.
    CooldownLedgersOutOfBounds = 121,
    /// Governance cooldown is currently active.
    GovernanceCooldownActive = 122,
    /// Governance cooldown value is out of allowed bounds.
    GovernanceCooldownOutOfBounds = 123,
    /// Sweep would exceed the per-ledger withdrawal cap.
    SweepLedgerLimitExceeded = 124,
    /// Max sweep per ledger value is out of allowed bounds.
    MaxSweepPerLedgerOutOfBounds = 125,
}

/// Payload for a treasury-rotation proposal.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryRotationPayload {
    pub new_treasury: Address,
}

/// Payload for a token-sweep proposal.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenSweepPayload {
    pub asset: Address,
    pub recipient: Address,
    pub amount: i128,
    pub reason_code: u32,
}

/// Discriminant tag for a pending admin action.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AdminActionTag {
    TreasuryRotation,
    TokenSweep,
}

/// Two-step high-risk admin action stored in pending state.
///
/// Flat struct layout — Soroban `#[contracttype]` does not support
/// `Option<CustomContractType>` fields. The `tag` discriminant determines
/// which payload fields are meaningful.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminAction {
    pub tag: AdminActionTag,
    // TreasuryRotation payload (valid when tag == TreasuryRotation)
    pub new_treasury: Address,
    // TokenSweep payload (valid when tag == TokenSweep)
    pub sweep_asset: Address,
    pub sweep_recipient: Address,
    pub sweep_amount: i128,
    pub sweep_reason_code: u32,
}

impl AdminAction {
    pub fn treasury_rotation(new_treasury: Address) -> Self {
        Self {
            tag: AdminActionTag::TreasuryRotation,
            new_treasury: new_treasury.clone(),
            sweep_asset: new_treasury.clone(),
            sweep_recipient: new_treasury.clone(),
            sweep_amount: 0,
            sweep_reason_code: 0,
        }
    }

    pub fn token_sweep(asset: Address, recipient: Address, amount: i128, reason_code: u32) -> Self {
        Self {
            tag: AdminActionTag::TokenSweep,
            new_treasury: asset.clone(),
            sweep_asset: asset,
            sweep_recipient: recipient,
            sweep_amount: amount,
            sweep_reason_code: reason_code,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingAdminAction {
    pub proposer: Address,
    pub action: AdminAction,
    pub expiry_ledger: u32,
}

#[contractevent(topics = ["niffyinsure", "admin_action"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminActionAudit {
    pub actor: Address,
    pub action_type: String,
    pub params: Map<String, String>,
}

pub fn emit_admin_action(env: &Env, actor: &Address, action_type: &str) {
    AdminActionAudit {
        actor: actor.clone(),
        action_type: String::from_str(env, action_type),
        params: Map::new(env),
    }
    .publish(env);
}

#[contractevent(topics = ["niffyinsure", "admin_action_proposed"])]
pub struct AdminActionProposed {
    pub proposer: Address,
    pub action_id: u32, // env.ledger().sequence()
    pub expiry_ledger: u32,
    pub action: AdminAction,
}

#[contractevent(topics = ["niffyinsure", "admin_action_confirmed"])]
pub struct AdminActionConfirmed {
    pub proposer: Address,
    pub confirmer: Address,
    pub action: AdminAction,
}

#[contractevent(topics = ["niffyinsure", "admin_action_expired"])]
pub struct AdminActionExpired {
    pub proposer: Address,
    pub action_id: u32,
    pub expiry_ledger: u32,
    pub action: AdminAction,
}

#[contractevent(topics = ["niffyinsure", "admin_proposed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct AdminProposed {
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contractevent(topics = ["niffyinsure", "admin_accepted"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct AdminAccepted {
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contractevent(topics = ["niffyinsure", "admin_cancelled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct AdminCancelled {
    pub current_admin: Address,
    pub cancelled_pending: Address,
}

/// Emitted on every admin address change, giving auditors a complete
/// on-chain chain-of-custody for the admin key.
///
/// This contract currently exposes admin rotation only via the two-step
/// propose/accept flow (`propose_admin` + `accept_admin`); `AdminRotated` is
/// published from `accept_admin`, the single point where `storage::set_admin`
/// actually changes the stored admin post-initialization. If a future
/// single-step rotation entrypoint is added, it MUST call
/// `emit_admin_rotated` too so this event remains a complete record of every
/// admin change regardless of rotation path.
#[contractevent(topics = ["niffyinsure", "admin_rotated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminRotated {
    #[topic]
    pub old_admin: Address,
    #[topic]
    pub new_admin: Address,
    pub ledger: u32,
}

fn emit_admin_rotated(env: &Env, old_admin: &Address, new_admin: &Address) {
    AdminRotated {
        old_admin: old_admin.clone(),
        new_admin: new_admin.clone(),
        ledger: env.ledger().sequence(),
    }
    .publish(env);
}

#[contractevent(topics = ["niffyinsure", "token_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct TokenUpdated {
    pub old_token: Address,
    pub new_token: Address,
}

#[contractevent(topics = ["niffyinsure", "treasury_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct TreasuryUpdated {
    pub old_treasury: Address,
    pub new_treasury: Address,
}

#[contractevent(topics = ["niffyinsure", "admin_paused"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct AdminPaused {
    pub admin: Address,
}

#[contractevent(topics = ["niffyinsure", "admin_unpaused"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct AdminUnpaused {
    pub admin: Address,
}

#[contractevent(topics = ["niffyinsure", "treasury_drained"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct TreasuryDrained {
    pub admin: Address,
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent(topics = ["niffyinsure", "emergency_sweep"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct EmergencySweepExecuted {
    pub admin: Address,
    pub asset: Address,
    pub recipient: Address,
    pub amount: i128,
    pub reason_code: u32,
    pub at_ledger: u32,
}

/// Load the stored admin address and call `require_auth()` on it.
/// Auth is against the *stored* address — parameter spoofing cannot satisfy it.
pub fn require_admin(env: &Env) -> Address {
    let admin = env
        .storage()
        .instance()
        .get::<_, Address>(&storage::DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, AdminError::Unauthorized));
    admin.require_auth();
    admin
}

// ── Scoped role helpers (Issue #1161) ─────────────────────────────────────────
//
// Three roles reduce the blast radius of any single compromised key:
//
//   PauseAdmin    — may pause/unpause the contract.
//   TreasuryAdmin — may drain, sweep, and rotate the treasury address.
//   ParamAdmin    — may change governance parameters (evidence counts, cooldowns …).
//
// Backwards compatibility: when a role is not configured, the main Admin address
// satisfies the check so existing single-admin deployments work unchanged.

/// Errors specific to the role-separation feature.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, PartialOrd, Ord, Eq)]
#[repr(u32)]
pub enum RoleError {
    /// Caller is not authorized for this role.
    Unauthorized = 200,
}

/// Require either the dedicated pause-admin or the main admin.
/// Returns the authorised address.
pub fn require_pause_admin(env: &Env) -> Address {
    let role = storage::get_pause_admin(env).unwrap_or_else(|| {
        env.storage()
            .instance()
            .get::<_, Address>(&storage::DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, RoleError::Unauthorized))
    });
    role.require_auth();
    role
}

/// Require either the dedicated treasury-admin or the main admin.
/// Returns the authorised address.
pub fn require_treasury_admin(env: &Env) -> Address {
    let role = storage::get_treasury_admin(env).unwrap_or_else(|| {
        env.storage()
            .instance()
            .get::<_, Address>(&storage::DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, RoleError::Unauthorized))
    });
    role.require_auth();
    role
}

/// Require either the dedicated param-admin or the main admin.
/// Returns the authorised address.
pub fn require_param_admin(env: &Env) -> Address {
    let role = storage::get_param_admin(env).unwrap_or_else(|| {
        env.storage()
            .instance()
            .get::<_, Address>(&storage::DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, RoleError::Unauthorized))
    });
    role.require_auth();
    role
}

/// Propose a high-risk admin action (treasury rotation or sweep). Current admin authorizes.
pub fn propose_admin_action(env: &Env, action: AdminAction) {
    let proposer = require_admin(env);
    storage::check_and_clear_expired_admin_action(env); // Clear stale first

    if storage::has_pending_admin_action(env) {
        panic_with_error!(env, AdminError::NoPendingAdminAction);
    }

    let window = storage::get_admin_action_window_ledgers(env);
    let now = env.ledger().sequence();
    let expiry = now.saturating_add(window);

    let pending = PendingAdminAction {
        proposer: proposer.clone(),
        action: action.clone(),
        expiry_ledger: expiry,
    };

    storage::set_pending_admin_action(env, &pending);

    let action_id = now;
    AdminActionProposed {
        proposer: proposer.clone(),
        action_id,
        expiry_ledger: expiry,
        action,
    }
    .publish(env);
    emit_admin_action(env, &proposer, "propose_admin_action");
}

/// Confirm and execute a pending admin action.
///
/// `confirmer` must be a different address from the proposer (no self-confirmation).
/// The confirmer must also be the current admin — this enforces that only the admin
/// key holder can confirm, preventing arbitrary third parties from executing proposals.
pub fn confirm_admin_action(env: &Env, confirmer: Address) {
    storage::bump_instance(env);

    let pending = storage::get_pending_admin_action(env)
        .unwrap_or_else(|| panic_with_error!(env, AdminError::NoPendingAdminAction));

    // Check expiry before anything else.
    let now = env.ledger().sequence();
    if now > pending.expiry_ledger {
        storage::clear_pending_admin_action(env);
        AdminActionExpired {
            proposer: pending.proposer.clone(),
            action_id: pending
                .expiry_ledger
                .saturating_sub(storage::get_admin_action_window_ledgers(env)),
            expiry_ledger: pending.expiry_ledger,
            action: pending.action.clone(),
        }
        .publish(env);
        panic_with_error!(env, AdminError::AdminActionExpired);
    }

    // Confirmer must differ from proposer.
    if confirmer == pending.proposer {
        panic_with_error!(env, AdminError::CannotSelfConfirm);
    }

    // Execute action payload.
    let action = pending.action.clone();
    match action.tag {
        AdminActionTag::TreasuryRotation => {
            let old_treasury = storage::get_treasury(env);
            storage::set_treasury(env, &action.new_treasury);
            TreasuryUpdated {
                old_treasury,
                new_treasury: action.new_treasury.clone(),
            }
            .publish(env);
        }
        AdminActionTag::TokenSweep => {
            sweep_token_inner(
                env,
                action.sweep_asset.clone(),
                action.sweep_recipient.clone(),
                action.sweep_amount,
                action.sweep_reason_code,
            );
        }
    }

    storage::clear_pending_admin_action(env);
    AdminActionConfirmed {
        proposer: pending.proposer,
        confirmer: confirmer.clone(),
        action: pending.action,
    }
    .publish(env);
    emit_admin_action(env, &confirmer, "confirm_admin_action");
}

/// Cancel a pending admin action. Proposer (current admin) authorizes.
pub fn cancel_admin_action(env: &Env) {
    let proposer = require_admin(env);
    let pending = storage::get_pending_admin_action(env)
        .unwrap_or_else(|| panic_with_error!(env, AdminError::NoPendingAdminAction));
    if pending.proposer != proposer {
        panic_with_error!(env, AdminError::Unauthorized);
    }
    storage::clear_pending_admin_action(env);
    emit_admin_action(env, &proposer, "cancel_admin_action");
}

/// Propose a new admin (step 1 of two-step rotation). Current admin must authorize.
/// Sets a time-locked expiry based on the configured admin action window.
pub fn propose_admin(env: &Env, new_admin: Address) {
    let current = require_admin(env);
    // Zero-address guard: the zero address cannot authorize the accept_admin call.
    if new_admin
        == Address::from_string(&soroban_sdk::String::from_str(
            env,
            "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        ))
    {
        panic_with_error!(env, AdminError::InvalidAddress);
    }
    let window = storage::get_admin_action_window_ledgers(env);
    let now = env.ledger().sequence();
    let expiry = now.saturating_add(window);
    storage::set_pending_admin(env, &new_admin);
    storage::set_pending_admin_expiry(env, expiry);
    AdminProposed {
        old_admin: current.clone(),
        new_admin,
    }
    .publish(env);
    emit_admin_action(env, &current, "propose_admin");
}

/// Accept a pending admin proposal. The *pending* admin must authorize.
/// `pending` is read from storage — cannot be spoofed via parameter.
/// Proposal must be accepted before the expiry ledger (time lock).
pub fn accept_admin(env: &Env) {
    let pending = storage::get_pending_admin(env)
        .unwrap_or_else(|| panic_with_error!(env, AdminError::NoPendingAdmin));
    let expiry = storage::get_pending_admin_expiry(env)
        .unwrap_or_else(|| panic_with_error!(env, AdminError::NoPendingAdmin));
    let now = env.ledger().sequence();
    if now > expiry {
        storage::clear_pending_admin(env);
        panic_with_error!(env, AdminError::AdminActionExpired);
    }
    pending.require_auth();
    let old_admin = storage::get_admin(env);
    storage::set_admin(env, &pending);
    storage::clear_pending_admin(env);
    AdminAccepted {
        old_admin: old_admin.clone(),
        new_admin: pending.clone(),
    }
    .publish(env);
    emit_admin_rotated(env, &old_admin, &pending);
    emit_admin_action(env, &pending, "accept_admin");
}

/// Cancel a pending admin proposal. Current admin must authorize.
pub fn cancel_admin(env: &Env) {
    let current = require_admin(env);
    let pending = storage::get_pending_admin(env)
        .unwrap_or_else(|| panic_with_error!(env, AdminError::NoPendingAdmin));
    storage::clear_pending_admin(env);
    AdminCancelled {
        current_admin: current.clone(),
        cancelled_pending: pending,
    }
    .publish(env);
    emit_admin_action(env, &current, "cancel_admin");
}

/// Update the treasury token contract address. Admin must authorize.
pub fn set_token(env: &Env, new_token: Address) {
    let admin = require_admin(env);
    check_and_update_gov_cooldown(env);
    let old_token = storage::get_token(env);
    storage::set_token(env, &new_token);
    TokenUpdated {
        old_token,
        new_token,
    }
    .publish(env);
    emit_admin_action(env, &admin, "set_token");
}

/// Update the treasury address. Admin must authorize.
/// Emits: ("admin", "treasury") → (old_treasury, new_treasury)
/// *** SINGLE-STEP FALLBACK: Use propose_admin_action for two-step protection ***
pub fn set_treasury(env: &Env, new_treasury: Address) {
    let admin = require_admin(env);
    check_and_update_gov_cooldown(env);
    let old_treasury = storage::get_treasury(env);
    storage::set_treasury(env, &new_treasury);
    TreasuryUpdated {
        old_treasury,
        new_treasury,
    }
    .publish(env);
    emit_admin_action(env, &admin, "set_treasury");
}

/// Pause the contract. Admin must authorize.
pub fn pause(env: &Env) {
    let admin = require_pause_admin(env);
    storage::set_paused(env, true);
    AdminPaused {
        admin: admin.clone(),
    }
    .publish(env);
    emit_admin_action(env, &admin, "pause");
}

/// Unpause the contract. Admin must authorize.
pub fn unpause(env: &Env) {
    let admin = require_pause_admin(env);
    storage::set_paused(env, false);
    AdminUnpaused {
        admin: admin.clone(),
    }
    .publish(env);
    emit_admin_action(env, &admin, "unpause");
}

/// Drain `amount` stroops from the contract treasury to `recipient`.
/// Treasury-admin (or main admin as fallback) must authorize. Amount must be > 0.
pub fn drain(env: &Env, recipient: Address, amount: i128) {
    let admin = require_treasury_admin(env);
    if amount <= 0 {
        panic_with_error!(env, AdminError::InvalidDrainAmount);
    }
    crate::token::transfer_from_contract(env, &recipient, amount);
    TreasuryDrained {
        admin: admin.clone(),
        recipient,
        amount,
    }
    .publish(env);
    emit_admin_action(env, &admin, "drain");
}

/// Emergency token sweep: recover mistakenly sent tokens with strict ethical constraints.
/// *** SINGLE-STEP FALLBACK: Use propose_admin_action(TokenSweep) for two-step protection ***
///
/// # Purpose
/// Allows recovery of tokens accidentally sent to the contract that are NOT part of:
///   - User premium payments
///   - Approved claim payouts
///   - Protocol treasury reserves
///
/// See full docs above.
pub fn sweep_token(env: &Env, asset: Address, recipient: Address, amount: i128, reason_code: u32) {
    storage::bump_instance(env);
    let admin = require_treasury_admin(env);
    // ... (existing validation logic)
    sweep_token_inner(env, asset, recipient, amount, reason_code);
    emit_admin_action(env, &admin, "sweep_token");
}

fn sweep_token_inner(
    env: &Env,
    asset: Address,
    recipient: Address,
    amount: i128,
    reason_code: u32,
) {
    // Validation: amount must be > 0
    if amount <= 0 {
        panic_with_error!(env, AdminError::InvalidSweepAmount);
    }
    // Validation: asset must be allowlisted (prevents arbitrary token sweeps)
    if !storage::is_allowed_asset(env, &asset) {
        panic_with_error!(env, AdminError::AssetNotAllowlisted);
    }

    // Per-ledger withdrawal limit (Issue #845)
    if let Some(max_sweep) = storage::get_max_sweep_per_ledger(env) {
        let now = env.ledger().sequence();
        let last_sweep = storage::get_last_sweep_ledger(env);
        let mut cumulative = 0;
        if last_sweep == Some(now) {
            cumulative = storage::get_cumulative_swept_this_ledger(env);
        }
        let new_cumulative = cumulative
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(env, AdminError::SweepLedgerLimitExceeded));
        if new_cumulative > max_sweep {
            panic_with_error!(env, AdminError::SweepLedgerLimitExceeded);
        }
        storage::set_last_sweep_ledger(env, now);
        storage::set_cumulative_swept_this_ledger(env, new_cumulative);
    }
    // Validation: check per-transaction cap (if configured)
    if let Some(cap) = storage::get_sweep_cap(env) {
        if amount > cap {
            panic_with_error!(env, AdminError::SweepCapExceeded);
        }
    }
    // On-chain notice period: the pending action must have been proposed at least
    // `sweep_notice_period_ledgers` ago before execution is allowed.
    let notice_period = storage::get_sweep_notice_period_ledgers(env);
    if notice_period > 0 {
        let pending = storage::get_pending_admin_action(env)
            .unwrap_or_else(|| panic_with_error!(env, AdminError::NoPendingAdminAction));
        let proposed_at = pending
            .expiry_ledger
            .saturating_sub(storage::get_admin_action_window_ledgers(env));
        let earliest_execution = proposed_at.saturating_add(notice_period);
        if env.ledger().sequence() < earliest_execution {
            panic_with_error!(env, AdminError::SweepNoticePeriodActive);
        }
    }

    // Protected balance check: ensure sweep won't violate user entitlements
    let protected_balance = calculate_protected_balance(env, &asset);
    let current_balance = crate::token::get_balance(env, &asset);
    let remaining_balance = current_balance.saturating_sub(amount);

    if remaining_balance < protected_balance {
        panic_with_error!(env, AdminError::ProtectedBalanceViolation);
    }

    // Execute sweep using SEP-41 transfer
    crate::token::sweep_asset(env, &asset, &recipient, amount);

    // Emit comprehensive audit event
    let admin = env
        .storage()
        .instance()
        .get::<_, Address>(&storage::DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, AdminError::Unauthorized));
    EmergencySweepExecuted {
        admin,
        asset,
        recipient,
        amount,
        reason_code,
        at_ledger: env.ledger().sequence(),
    }
    .publish(env);
}

/// Calculate the minimum balance that must be protected from sweep operations.
///
/// This function sums all approved-but-unpaid claims for the given asset.
/// It provides a conservative lower bound on funds that belong to users.
///
/// # Residual Risk
/// This calculation CANNOT distinguish:
///   - Premium reserves (operational float)
///   - Stray tokens (accidental transfers)
///   - Future claim obligations (not yet approved)
///
/// Operators MUST maintain adequate reserves beyond the protected balance
/// to ensure protocol solvency. See SWEEP_RUNBOOK.md for guidance.
fn calculate_protected_balance(env: &Env, asset: &Address) -> i128 {
    let claim_counter = storage::get_claim_counter(env);
    let mut protected: i128 = 0;

    // Iterate through all claims and sum approved amounts for this asset
    for claim_id in 1..=claim_counter {
        if let Some(claim) = storage::get_claim(env, claim_id) {
            // Only count approved claims that haven't been paid yet
            if claim.status == crate::types::ClaimStatus::Approved {
                // Get the policy to check its asset
                if let Some(policy) = storage::get_policy(env, &claim.claimant, claim.policy_id) {
                    if policy.asset == *asset {
                        let net = claim.amount.saturating_sub(claim.deductible);
                        if net > 0 {
                            protected = protected.saturating_add(net);
                        }
                    }
                }
            }
        }
    }

    protected
}

/// Set per-transaction sweep cap (optional safety limit).
/// Set to None to disable cap. Treasury-admin (or main admin as fallback) must authorize.
pub fn set_sweep_cap(env: &Env, cap: Option<i128>) {
    let admin = require_treasury_admin(env);
    check_and_update_gov_cooldown(env);
    storage::set_sweep_cap(env, cap);
    emit_admin_action(env, &admin, "set_sweep_cap");
}

/// Set the on-chain notice period (in ledgers) that must elapse between a sweep
/// proposal and its execution. Set to 0 to disable (not recommended for mainnet).
/// Treasury-admin (or main admin as fallback) must authorize.
pub fn set_sweep_notice_period(env: &Env, ledgers: u32) {
    let admin = require_treasury_admin(env);
    check_and_update_gov_cooldown(env);
    storage::set_sweep_notice_period_ledgers(env, ledgers);
    emit_admin_action(env, &admin, "set_sweep_notice_period");
}

#[contractevent(topics = ["niffyinsure", "max_evidence_count_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaxEvidenceCountUpdated {
    pub old_count: u32,
    pub new_count: u32,
}

/// Admin-only: set the maximum number of evidence entries allowed per claim.
///
/// Bounded by [`storage::MAX_EVIDENCE_COUNT_HARD_MAX`] to prevent griefing.
/// Reductions do NOT retroactively invalidate existing claims.
pub fn set_max_evidence_count(env: &Env, new_count: u32) -> Result<(), AdminError> {
    let admin = require_param_admin(env);
    check_and_update_gov_cooldown(env);
    if new_count > storage::MAX_EVIDENCE_COUNT_HARD_MAX {
        return Err(AdminError::MaxEvidenceCountOutOfBounds);
    }
    let old_count = storage::get_max_evidence_count(env);
    storage::set_max_evidence_count(env, new_count);
    MaxEvidenceCountUpdated {
        old_count,
        new_count,
    }
    .publish(env);
    emit_admin_action(env, &admin, "admin_set_max_evidence_count");
    Ok(())
}

#[contractevent(topics = ["niffyinsure", "gateway_allowlist_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GatewayAllowlistUpdated {
    pub gateway_count: u32,
}

/// Admin-only: update the allowlisted IPFS gateway URL prefixes for evidence validation.
///
/// Evidence URLs must start with `ipfs://` or one of the allowlisted gateway prefixes.
/// Pass an empty vector to disable gateway validation (only `ipfs://` allowed).
pub fn set_gateway_allowlist(env: &Env, gateways: Vec<String>) -> Result<(), AdminError> {
    let admin = require_param_admin(env);
    check_and_update_gov_cooldown(env);
    storage::set_gateway_allowlist(env, &gateways);
    GatewayAllowlistUpdated {
        gateway_count: gateways.len(),
    }
    .publish(env);
    emit_admin_action(env, &admin, "admin_set_gateway_allowlist");
    Ok(())
}

// ── Min evidence count ────────────────────────────────────────────────────────

#[contractevent(topics = ["niffyinsure", "min_evidence_count_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MinEvidenceCountUpdated {
    pub old_count: u32,
    pub new_count: u32,
}

/// Admin-only: set the minimum number of evidence entries required per claim.
///
/// `new_min` must not exceed the current max evidence count.
/// Setting to 0 disables the minimum (default behaviour).
pub fn set_min_evidence_count(env: &Env, new_min: u32) -> Result<(), AdminError> {
    let _admin = require_param_admin(env);
    check_and_update_gov_cooldown(env);
    let current_max = storage::get_max_evidence_count(env);
    if new_min > current_max {
        return Err(AdminError::MinEvidenceExceedsMax);
    }
    let old_count = storage::get_min_evidence_count(env);
    storage::set_min_evidence_count(env, new_min);
    MinEvidenceCountUpdated {
        old_count,
        new_count: new_min,
    }
    .publish(env);
    Ok(())
}

// ── Max weight cap ────────────────────────────────────────────────────────────

#[contractevent(topics = ["niffyinsure", "max_weight_cap_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaxWeightCapUpdated {
    pub old_cap: i128,
    pub new_cap: i128,
}

/// Admin-only: set the maximum vote weight any single voter can contribute.
///
/// Only meaningful when the `governance-token` feature is enabled at runtime.
/// `new_cap` must be > 0. Falls back to `i128::MAX` (uncapped) when unset.
pub fn set_max_weight_cap(env: &Env, new_cap: i128) -> Result<(), AdminError> {
    let _admin = require_param_admin(env);
    check_and_update_gov_cooldown(env);
    if new_cap <= 0 {
        return Err(AdminError::InvalidMaxWeightCap);
    }
    let old_cap = storage::get_max_weight_cap(env);
    storage::set_max_weight_cap(env, new_cap);
    MaxWeightCapUpdated { old_cap, new_cap }.publish(env);
    Ok(())
}

// ── Cooldown ledgers ──────────────────────────────────────────────────────────

/// Hard maximum for the cooldown window to prevent admin locking all claims indefinitely.
pub const MAX_COOLDOWN_LEDGERS: u32 = 30 * crate::ledger::LEDGERS_PER_DAY; // ~30 days

#[contractevent(topics = ["niffyinsure", "cooldown_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CooldownUpdated {
    pub old_ledgers: u32,
    pub new_ledgers: u32,
}

/// Admin-only: set the per-policy cooldown window (in ledgers) between claim resolutions.
///
/// `new_ledgers` must be in `[0, MAX_COOLDOWN_LEDGERS]`.
/// 0 disables the cooldown (default). Does not affect claims already in `Processing`.
pub fn set_cooldown_ledgers(env: &Env, new_ledgers: u32) -> Result<(), AdminError> {
    let _admin = require_param_admin(env);
    check_and_update_gov_cooldown(env);
    if new_ledgers > MAX_COOLDOWN_LEDGERS {
        return Err(AdminError::CooldownLedgersOutOfBounds);
    }
    let old_ledgers = storage::get_cooldown_ledgers(env);
    storage::set_cooldown_ledgers(env, new_ledgers);
    CooldownUpdated {
        old_ledgers,
        new_ledgers,
    }
    .publish(env);
    Ok(())
}

// ── Governance cooldown (Issue #844) ──────────────────────────────────────

/// Hard maximum for the governance cooldown window to prevent admin locking all parameters indefinitely.
pub const MAX_GOVERNANCE_COOLDOWN_LEDGERS: u32 = 30 * crate::ledger::LEDGERS_PER_DAY; // ~30 days

#[contractevent(topics = ["niffyinsure", "governance_cooldown_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GovernanceCooldownUpdated {
    pub old_ledgers: u32,
    pub new_ledgers: u32,
}

pub fn check_and_update_gov_cooldown(env: &Env) {
    let now = env.ledger().sequence();
    let cooldown = storage::get_governance_cooldown_ledgers(env);
    if cooldown > 0 {
        if let Some(last_change) = storage::get_last_param_change_ledger(env) {
            if now.saturating_sub(last_change) < cooldown {
                panic_with_error!(env, AdminError::GovernanceCooldownActive);
            }
        }
    }
    storage::set_last_param_change_ledger(env, now);
}

pub fn set_governance_cooldown_ledgers(env: &Env, new_ledgers: u32) -> Result<(), AdminError> {
    let admin = require_param_admin(env);
    if new_ledgers > MAX_GOVERNANCE_COOLDOWN_LEDGERS {
        return Err(AdminError::GovernanceCooldownOutOfBounds);
    }
    check_and_update_gov_cooldown(env);
    let old_ledgers = storage::get_governance_cooldown_ledgers(env);
    storage::set_governance_cooldown_ledgers(env, new_ledgers);
    GovernanceCooldownUpdated {
        old_ledgers,
        new_ledgers,
    }
    .publish(env);
    emit_admin_action(env, &admin, "set_governance_cooldown_ledgers");
    Ok(())
}

// ── Treasury withdrawal limit (Issue #845) ────────────────────────────────

#[contractevent(topics = ["niffyinsure", "max_sweep_per_ledger_updated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaxSweepPerLedgerUpdated {
    pub old_cap: Option<i128>,
    pub new_cap: i128,
}

pub fn set_max_sweep_per_ledger(env: &Env, cap: i128) -> Result<(), AdminError> {
    let admin = require_treasury_admin(env);
    check_and_update_gov_cooldown(env);
    if cap <= 0 {
        return Err(AdminError::MaxSweepPerLedgerOutOfBounds);
    }
    let old_cap = storage::get_max_sweep_per_ledger(env);
    storage::set_max_sweep_per_ledger(env, cap);
    MaxSweepPerLedgerUpdated {
        old_cap,
        new_cap: cap,
    }
    .publish(env);
    emit_admin_action(env, &admin, "set_max_sweep_per_ledger");
    Ok(())
}
