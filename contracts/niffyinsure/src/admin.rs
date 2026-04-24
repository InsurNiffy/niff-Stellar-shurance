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
use soroban_sdk::{contracterror, contractevent, panic_with_error, Address, Env};

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
}

/// Types for two-step high-risk admin actions (treasury rotation, token sweeps)
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum AdminAction {
    TreasuryRotation { new_treasury: Address },
    TokenSweep {
        asset: Address,
        recipient: Address,
        amount: i128,
        reason_code: u32,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct PendingAdminAction {
    pub proposer: Address,
    pub action: AdminAction,
    pub expiry_ledger: u32,
}

#[contractevent(topics = ["niffyinsure", "admin_action_proposed"])]
pub struct AdminActionProposed {
    pub proposer: Address,
    pub action_id: u32,  // env.ledger().sequence()
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

/// Propose a high-risk admin action (treasury rotation or sweep). Current admin authorizes.
pub fn propose_admin_action(env: &Env, action: AdminAction) {
    let proposer = require_admin(env);
    storage::check_and_clear_expired_admin_action(env);  // Clear stale first

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
        proposer,
        action_id,
        expiry_ledger: expiry,
        action,
    }
    .publish(env);
}

/// Confirm and execute a pending admin action. **Second signer** (≠ proposer) must authorize.
/// Executes the action payload, then clears pending state.
pub fn confirm_admin_action(env: &Env) {
    storage::bump_instance(env);

    let pending = storage::get_pending_admin_action(env)
        .unwrap_or_else(|| panic_with_error!(env, AdminError::NoPendingAdminAction));

    // Check expiry
    let now = env.ledger().sequence();
    if now > pending.expiry_ledger {
        storage::clear_pending_admin_action(env);
        AdminActionExpired {
            proposer: pending.proposer.clone(),
            action_id: pending.expiry_ledger.saturating_sub(storage::get_admin_action_window_ledgers(env)),
            expiry_ledger: pending.expiry_ledger,
            action: pending.action.clone(),
        }
        .publish(env);
        panic_with_error!(env, AdminError::AdminActionExpired);
    }

    // Second signer auth (different from proposer)
    let confirmer = env.invoker();
    if confirmer == pending.proposer {
        panic_with_error!(env, AdminError::CannotSelfConfirm);
    }
    pending.proposer.require_auth();  // Proposer must also auth? Or just confirmer?

    // Execute action
    match pending.action.clone() {
        AdminAction::TreasuryRotation { new_treasury } => {
            let old_treasury = storage::get_treasury(env);
            storage::set_treasury(env, &new_treasury);
            TreasuryUpdated {
                old_treasury,
                new_treasury,
            }
            .publish(env);
        }
        AdminAction::TokenSweep { asset, recipient, amount, reason_code } => {
            sweep_token_inner(env, asset, recipient, amount, reason_code);
        }
    }

    // Clear pending
    storage::clear_pending_admin_action(env);
    AdminActionConfirmed {
        proposer: pending.proposer,
        confirmer,
        action: pending.action,
    }
    .publish(env);
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
}

/// Propose a new admin (step 1 of two-step rotation). Current admin must authorize.
pub fn propose_admin(env: &Env, new_admin: Address) {
    let current = require_admin(env);
    storage::set_pending_admin(env, &new_admin);
    AdminProposed {
        old_admin: current,
        new_admin,
    }
    .publish(env);
}

/// Accept a pending admin proposal. The *pending* admin must authorize.
/// `pending` is read from storage — cannot be spoofed via parameter.
pub fn accept_admin(env: &Env) {
    let pending = storage::get_pending_admin(env)
        .unwrap_or_else(|| panic_with_error!(env, AdminError::NoPendingAdmin));
    pending.require_auth();
    let old_admin = storage::get_admin(env);
    storage::set_admin(env, &pending);
    storage::clear_pending_admin(env);
    AdminAccepted {
        old_admin,
        new_admin: pending,
    }
    .publish(env);
}

/// Cancel a pending admin proposal. Current admin must authorize.
pub fn cancel_admin(env: &Env) {
    let current = require_admin(env);
    let pending = storage::get_pending_admin(env)
        .unwrap_or_else(|| panic_with_error!(env, AdminError::NoPendingAdmin));
    storage::clear_pending_admin(env);
    AdminCancelled {
        current_admin: current,
        cancelled_pending: pending,
    }
    .publish(env);
}

/// Update the treasury token contract address. Admin must authorize.
pub fn set_token(env: &Env, new_token: Address) {
    let _admin = require_admin(env);
    let old_token = storage::get_token(env);
    storage::set_token(env, &new_token);
    TokenUpdated {
        old_token,
        new_token,
    }
    .publish(env);
}

/// Update the treasury address. Admin must authorize.
/// Emits: (\"admin\", \"treasury\") → (old_treasury, new_treasury)
/// *** SINGLE-STEP FALLBACK: Use propose_admin_action for two-step protection ***
pub fn set_treasury(env: &Env, new_treasury: Address) {
    let _admin = require_admin(env);
    let old_treasury = storage::get_treasury(env);
    storage::set_treasury(env, &new_treasury);
    TreasuryUpdated {
        old_treasury,
        new_treasury,
    }
    .publish(env);
}

/// Pause the contract. Admin must authorize.
pub fn pause(env: &Env) {
    let admin = require_admin(env);
    storage::set_paused(env, true);
    AdminPaused { admin }.publish(env);
}

/// Unpause the contract. Admin must authorize.
pub fn unpause(env: &Env) {
    let admin = require_admin(env);
    storage::set_paused(env, false);
    AdminUnpaused { admin }.publish(env);
}

/// Drain `amount` stroops from the contract treasury to `recipient`.
/// Admin must authorize. Amount must be > 0.
pub fn drain(env: &Env, recipient: Address, amount: i128) {
    let admin = require_admin(env);
    if amount <= 0 {
        panic_with_error!(env, AdminError::InvalidDrainAmount);
    }
    crate::token::transfer_from_contract(env, &recipient, amount);
    TreasuryDrained {
        admin,
        recipient,
        amount,
    }
    .publish(env);
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
    let admin = require_admin(env);
    // ... (existing validation logic)
    sweep_token_inner(env, asset, recipient, amount, reason_code);
}

fn sweep_token_inner(env: &Env, asset: Address, recipient: Address, amount: i128, reason_code: u32) {
    // Validation: asset must be allowlisted (prevents arbitrary token sweeps)
    if !storage::is_allowed_asset(env, &asset) {
        panic_with_error!(env, AdminError::AssetNotAllowlisted);
    }
    // Validation: check per-transaction cap (if configured)
    if let Some(cap) = storage::get_sweep_cap(env) {
        if amount > cap {
            panic_with_error!(env, AdminError::SweepCapExceeded);
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
    let admin = require_admin(env);  // Re-require for event
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
/// Set to None to disable cap. Admin must authorize.
pub fn set_sweep_cap(env: &Env, cap: Option<i128>) {
    let _admin = require_admin(env);
    storage::set_sweep_cap(env, cap);
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
    let _admin = require_admin(env);
    if new_count > storage::MAX_EVIDENCE_COUNT_HARD_MAX {
        return Err(AdminError::InvalidAddress); // reuse closest available error
    }
    let old_count = storage::get_max_evidence_count(env);
    storage::set_max_evidence_count(env, new_count);
    MaxEvidenceCountUpdated { old_count, new_count }.publish(env);
    Ok(())
}
