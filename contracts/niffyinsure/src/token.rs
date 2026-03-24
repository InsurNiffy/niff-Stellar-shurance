/// Token interaction helpers.
///
/// # Trust model for external token contracts
///
/// NiffyInsure interacts with exactly one token contract whose address is
/// stored at `DataKey::Token` and is admin-controlled.  The following trust
/// assumptions apply:
///
/// - **Allowlisted address only**: `transfer_from_contract` reads the stored
///   token address and passes it to `invoke_contract`.  No caller-supplied
///   token address is accepted in payment paths, eliminating the class of
///   attack where a malicious token contract is substituted to drain funds or
///   execute arbitrary logic.
///
/// - **Admin responsibility**: The admin who calls `set_token` is responsible
///   for verifying the token contract is a well-behaved SEP-41 implementation.
///   Production deployments SHOULD use a known, audited token (e.g. USDC on
///   Stellar).  The admin MUST NOT point `Token` at a contract they do not
///   control or have not audited.
///
/// - **Reentrancy under Soroban semantics**: Soroban cross-contract calls are
///   synchronous and single-threaded.  There is no callback mechanism that
///   could re-enter this contract mid-execution.  The token's `transfer`
///   function executes to completion before control returns here.  This
///   eliminates the classic EVM reentrancy attack vector.  However, a
///   malicious token could still panic or return unexpected values; the
///   `invoke_contract` call will propagate any panic, reverting the entire
///   transaction atomically.
///
/// - **`from = current_contract_address()`**: When the contract transfers its
///   own funds, Soroban's auth framework automatically authorizes the contract
///   as the sender without requiring an explicit `require_auth` call on the
///   contract address.  This is the correct and intended pattern per the
///   Soroban SDK documentation.
///
/// # Future: multi-asset support
///
/// If multiple supported assets are needed, replace `DataKey::Token` with
/// `DataKey::AllowedToken(Address)` → bool and validate the token address
/// against that set before invoking.  The `transfer_from_contract` signature
/// below already accepts a `token` parameter to make that migration trivial.
use soroban_sdk::{panic_with_error, Address, Env};

use crate::{admin::AdminError, storage};

/// Transfer `amount` of the **allowlisted** treasury token from `from` to `to`.
///
/// Panics with `AdminError::InvalidAddress` if `token` does not match the
/// stored treasury token address, preventing arbitrary token substitution.
pub fn transfer_from_contract(env: &Env, to: &Address, amount: i128) {
    let allowed = storage::get_token(env);
    let from = env.current_contract_address();
    transfer(env, &allowed, &from, to, amount);
}

/// Low-level SEP-41 `transfer` invocation.
///
/// Callers inside this crate MUST ensure `token` is the allowlisted address
/// (use `transfer_from_contract` for outbound treasury payments).
/// This function is `pub(crate)` to prevent external misuse.
pub(crate) fn transfer(env: &Env, token: &Address, from: &Address, to: &Address, amount: i128) {
    // Defence-in-depth: verify token matches the stored allowlist even for
    // internal callers, so a future refactor cannot accidentally bypass it.
    let allowed = storage::get_token(env);
    if token != &allowed {
        panic_with_error!(env, AdminError::InvalidAddress);
    }

    let args = soroban_sdk::vec![
        env,
        soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(from, env),
        soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(to, env),
        soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&amount, env),
    ];
    env.invoke_contract::<()>(token, &soroban_sdk::Symbol::new(env, "transfer"), args);
}
