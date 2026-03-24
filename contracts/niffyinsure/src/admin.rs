/// Privileged administration: admin rotation, token update, pause toggle, drain.
///
/// # Centralization disclosure (for users / auditors)
///
/// Community policyholders govern claim outcomes via DAO voting — no admin
/// override exists on individual claims.  However, the following protocol
/// parameters remain admin-controlled in the MVP:
///
/// - Token contract address (treasury asset)
/// - Pause / unpause (emergency circuit-breaker)
/// - Admin key itself (rotation)
/// - Treasury drain (emergency fund recovery)
///
/// This is a deliberate MVP trade-off.  Production deployments SHOULD use a
/// Stellar multisig account (e.g. 3-of-5 signers) as the admin address.
///
/// # Multisig guidance for production
///
/// Stellar natively supports weighted multisig via `set_options`:
///   - Create a dedicated admin account with master weight 0.
///   - Add 5 co-signer keys with weight 1 each; set all thresholds to 3.
///   - The resulting address is the `admin` passed to `initialize`.
///   - All admin calls require 3-of-5 signatures in the transaction envelope.
///   - Use hardware-wallet-backed signers for highest assurance.
///
/// # Auth model
///
/// Every privileged entrypoint calls `require_admin(env)` which:
///   1. Loads the stored admin address from instance storage.
///   2. Calls `admin.require_auth()` — Soroban verifies the transaction was
///      signed by that exact address.  A caller passing a different address
///      as a parameter cannot satisfy this check; the stored address is the
///      sole authority.
///
/// # Future timelock / governance seam
///
/// Each setter is a direct write today.  To add a timelock:
///   1. Replace the write with `Proposal { action, value, eta }` at
///      `DataKey::Proposal(action_id)`.
///   2. Add `execute_proposal(env, action_id)` checking
///      `env.ledger().timestamp() >= eta`.
///   3. The event schema is already action-typed; NestJS ingestion unchanged.
///
/// # Event schema (machine-readable for NestJS ingestion)
///
/// Every mutation emits:
///   topic:   ("admin", "<action_name>")
///   payload: action-specific — see individual functions.
///
/// The NestJS handler keys on `topic[1]` to route to the correct
/// `admin_audit_log` column without per-action parsers.
use soroban_sdk::{contracttype, panic_with_error, symbol_short, Address, Env};

use crate::storage;

// ── Error codes ───────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq)]
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
}

// ── Auth helper ───────────────────────────────────────────────────────────────

/// Load the stored admin address and call `require_auth()` on it.
///
/// The auth check is against the *stored* address, not any caller-supplied
/// parameter.  This means parameter spoofing (passing a different address)
/// cannot satisfy the check — the transaction must be signed by whoever is
/// stored at `DataKey::Admin`.
pub fn require_admin(env: &Env) -> Address {
    let admin = env
        .storage()
        .instance()
        .get::<_, Address>(&storage::DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, AdminError::Unauthorized));
    admin.require_auth();
    admin
}

// ── Admin rotation (two-step handoff) ────────────────────────────────────────
//
// Two-step pattern prevents lockout from typos or uncontrolled keys:
//   - Immediate replacement would take effect before the new key is proven.
//   - Two-step requires the incoming admin to sign `accept_admin`, proving
//     key control before the handoff completes.
//
// Flow:
//   1. current admin → propose_admin(new_admin)
//   2. new_admin     → accept_admin()           → rotation complete
//   OR current admin → cancel_admin()           → proposal withdrawn
//
// Hijack prevention: accept_admin calls `pending.require_auth()` where
// `pending` is read from storage, not from any function parameter.  An
// unrelated signer cannot satisfy this check.
//
// Future timelock seam: step 1 could store an `eta`; step 2 checks it.

/// Propose a new admin address.  Current admin must authorize.
/// Emits: ("admin", "proposed") → (old_admin, new_admin)
pub fn propose_admin(env: &Env, new_admin: Address) {
    let current = require_admin(env);
    storage::set_pending_admin(env, &new_admin);
    env.events().publish(
        (symbol_short!("admin"), symbol_short!("proposed")),
        (current, new_admin),
    );
}

/// Accept a pending admin proposal.  The *pending* admin must authorize.
///
/// `pending` is read from storage — not from any parameter — so an unrelated
/// signer cannot hijack the rotation by passing their own address.
/// Emits: ("admin", "accepted") → (old_admin, new_admin)
pub fn accept_admin(env: &Env) {
    let pending = storage::get_pending_admin(env)
        .unwrap_or_else(|| panic_with_error!(env, AdminError::NoPendingAdmin));
    // Auth against the stored pending address — cannot be spoofed
    pending.require_auth();
    let old_admin = storage::get_admin(env);
    storage::set_admin(env, &pending);
    storage::clear_pending_admin(env);
    env.events().publish(
        (symbol_short!("admin"), symbol_short!("accepted")),
        (old_admin, pending),
    );
}

/// Cancel a pending admin proposal.  Current admin must authorize.
/// Emits: ("admin", "cancelled") → (current_admin, cancelled_pending)
pub fn cancel_admin(env: &Env) {
    let current = require_admin(env);
    let pending = storage::get_pending_admin(env)
        .unwrap_or_else(|| panic_with_error!(env, AdminError::NoPendingAdmin));
    storage::clear_pending_admin(env);
    env.events().publish(
        (symbol_short!("admin"), symbol_short!("cancelled")),
        (current, pending),
    );
}

// ── Token update ──────────────────────────────────────────────────────────────
//
// The token address is the single allowlisted contract for all payment paths.
// See token.rs for the full trust model.
//
// Future governance seam: replace with a proposal + timelock so token
// migrations are visible on-chain before they take effect.

/// Update the treasury token contract address.  Admin must authorize.
/// Emits: ("admin", "token") → (old_token, new_token)
pub fn set_token(env: &Env, new_token: Address) {
    let _admin = require_admin(env);
    let old_token = storage::get_token(env);
    storage::set_token(env, &new_token);
    env.events().publish(
        (symbol_short!("admin"), symbol_short!("token")),
        (old_token, new_token),
    );
}

// ── Pause toggle ──────────────────────────────────────────────────────────────
//
// Pause blocks file_claim and vote_on_claim (see claim.rs).
// In-flight votes and tallies are unaffected — pause is not retroactive.
// Future seam: add a community-vote-triggered unpause path.

/// Pause the contract.  Admin must authorize.
/// Emits: ("admin", "paused") → (admin)
pub fn pause(env: &Env) {
    let admin = require_admin(env);
    storage::set_paused(env, true);
    env.events()
        .publish((symbol_short!("admin"), symbol_short!("paused")), (admin,));
}

/// Unpause the contract.  Admin must authorize.
/// Emits: ("admin", "unpaused") → (admin)
pub fn unpause(env: &Env) {
    let admin = require_admin(env);
    storage::set_paused(env, false);
    env.events().publish(
        (symbol_short!("admin"), symbol_short!("unpaused")),
        (admin,),
    );
}

// ── Treasury drain ────────────────────────────────────────────────────────────
//
// Emergency fund recovery via the allowlisted token only.
// `transfer_from_contract` enforces the token allowlist — no arbitrary token
// address is accepted.
//
// Reentrancy: Soroban is single-threaded; cross-contract calls are synchronous
// with no callback path back into this contract.  Classic reentrancy is not
// possible.  A malicious token panicking will revert the whole transaction.
//
// Future governance seam: require a time-delayed proposal before drain
// executes, giving policyholders a window to exit.

/// Drain `amount` stroops from the contract treasury to `recipient`.
/// Admin must authorize.  Amount must be > 0.
/// Emits: ("admin", "drained") → (admin, recipient, amount)
pub fn drain(env: &Env, recipient: Address, amount: i128) {
    let admin = require_admin(env);
    if amount <= 0 {
        panic_with_error!(env, AdminError::InvalidDrainAmount);
    }
    // Uses allowlisted token only — see token.rs trust model
    crate::token::transfer_from_contract(env, &recipient, amount);
    env.events().publish(
        (symbol_short!("admin"), symbol_short!("drained")),
        (admin, recipient, amount),
    );
}
