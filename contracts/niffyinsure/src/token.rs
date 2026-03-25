/// Token interaction helpers.
///
/// # Trust model
/// Only the allowlisted token stored at DataKey::Token is used in payment paths.
/// `transfer_from_contract` reads the stored address directly — no caller-supplied
/// token address enters the payment path.
/// See SECURITY.md for the full trust model and reentrancy analysis.
use soroban_sdk::{panic_with_error, Address, Env};

use crate::{admin::AdminError, storage};

/// Transfer `amount` of the allowlisted treasury token from this contract to `to`.
/// Reads the token address from storage — no arbitrary token substitution possible.
pub fn transfer_from_contract(env: &Env, to: &Address, amount: i128) {
    let token = storage::get_token(env);
    let from = env.current_contract_address();
    transfer(env, &token, &from, to, amount);
}

/// Low-level SEP-41 `transfer` invocation.
/// Defence-in-depth: verifies `token` matches the stored allowlist.
/// `pub(crate)` — external callers must use `transfer_from_contract`.
pub(crate) fn transfer(env: &Env, token: &Address, from: &Address, to: &Address, amount: i128) {
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
