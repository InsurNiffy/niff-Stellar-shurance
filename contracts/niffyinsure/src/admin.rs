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
/// Emits: ("admin", "treasury") → (old_treasury, new_treasury)
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
///
/// # Purpose
/// Allows recovery of tokens accidentally sent to the contract that are NOT part of:
///   - User premium payments
///   - Approved claim payouts
///   - Protocol treasury reserves
///
/// # Ethical & Legal Constraints
/// This function MUST NEVER be used to:
///   - Confiscate user entitlements
///   - Avoid paying approved claims
///   - Seize funds that belong to policyholders
///
/// # Security Model
/// - Admin-only: requires multisig in production
/// - Asset allowlist: only sweep allowlisted tokens
/// - Per-transaction cap: optional limit via storage (default: no cap)
/// - Protected balance check: validates sweep won't violate user entitlements
/// - Comprehensive audit trail: emits detailed event with reason code
///
/// # Reason Codes (for audit/compliance)
/// - 1: Accidental user transfer (wrong address)
/// - 2: Test tokens sent to mainnet contract
/// - 3: Airdrop tokens not part of protocol operations
/// - 4: Deprecated asset migration
/// - 5-99: Reserved for future use
/// - 100+: Custom organizational codes
///
/// # Protected Balance Calculation
/// The contract cannot perfectly distinguish "stray" tokens from legitimate reserves
/// because premiums are collected into the treasury continuously. This function
/// performs a conservative check:
///   - Calculates total approved-but-unpaid claims
///   - Ensures sweep leaves sufficient balance to cover those obligations
///   - Documents residual risk: sweep may still affect operational reserves
///
/// # Production Requirements
/// - MUST use Stellar multisig admin account (3-of-5 or stronger)
/// - MUST obtain legal/compliance sign-off before mainnet enablement
/// - MUST document custody implications in operational runbook
/// - SHOULD set per-transaction cap via set_sweep_cap()
/// - SHOULD maintain off-chain audit log of all sweep operations
///
/// # Parameters
/// - `asset`: Token contract address (must be allowlisted)
/// - `recipient`: Destination address for swept tokens
/// - `amount`: Amount to sweep (must be > 0 and <= cap if set)
/// - `reason_code`: Machine-readable justification (see codes above)
///
/// # Emits
/// EmergencySweepExecuted {
///   admin, asset, recipient, amount, reason_code, at_ledger
/// }
///
/// # Panics
/// - AdminError::Unauthorized: caller is not admin
/// - AdminError::InvalidSweepAmount: amount <= 0
/// - AdminError::AssetNotAllowlisted: asset not on allowlist
/// - AdminError::SweepCapExceeded: amount > configured cap
/// - AdminError::ProtectedBalanceViolation: sweep would leave insufficient funds for claims
pub fn sweep_token(env: &Env, asset: Address, recipient: Address, amount: i128, reason_code: u32) {
    storage::bump_instance(env);
    let admin = require_admin(env);

    // Validation: amount must be positive
    if amount <= 0 {
        panic_with_error!(env, AdminError::InvalidSweepAmount);
    }

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
    // This is a conservative estimate - we calculate total approved claims
    // and ensure sufficient balance remains to cover them.
    let protected_balance = calculate_protected_balance(env, &asset);
    let current_balance = crate::token::get_balance(env, &asset);
    let remaining_balance = current_balance.saturating_sub(amount);

    if remaining_balance < protected_balance {
        panic_with_error!(env, AdminError::ProtectedBalanceViolation);
    }

    // Execute sweep using SEP-41 transfer
    crate::token::sweep_asset(env, &asset, &recipient, amount);

    // Emit comprehensive audit event
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
