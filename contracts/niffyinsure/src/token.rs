/// Token interaction helpers using SEP-41 Token interface.
///
/// # Trust model
/// Only allowlisted asset contract IDs may be used in payment paths.
/// `transfer_from_contract` reads the stored default token address.
/// `transfer` (used by the policy path) validates the asset is allowlisted
/// before invoking the SEP-41 contract — no arbitrary token substitution.
/// See SECURITY.md for the full trust model and reentrancy analysis.
use soroban_sdk::{token, Address, Env};

use crate::storage;

/// Collect `amount` of the policy's asset from `from` to the contract treasury.
/// The asset must already be allowlisted (validated by the caller).
pub fn collect_premium(env: &Env, from: &Address, asset: &Address, amount: i128) {
    let treasury = storage::get_treasury(env);
    let client = token::TokenClient::new(env, asset);
    client.transfer_from(&env.current_contract_address(), from, &treasury, &amount);
}

/// Transfer `amount` of the contract's default treasury token from this contract to `to`.
/// Used for admin drain operations.
pub fn transfer_from_contract(env: &Env, to: &Address, amount: i128) {
    let token_addr = storage::get_token(env);
    let client = token::TokenClient::new(env, &token_addr);
    client.transfer(&env.current_contract_address(), to, &amount);
}

/// Low-level SEP-41 `transfer` invocation for a specific allowlisted asset.
///
/// Defence-in-depth: verifies `token` is on the allowlist before invoking.
/// `pub(crate)` — callers in the policy path must have already validated the asset.
pub(crate) fn transfer(env: &Env, token: &Address, from: &Address, to: &Address, amount: i128) {
    if !storage::is_allowed_asset(env, token) {
        panic!("token not allowlisted");
    }
    let args = soroban_sdk::vec![
        env,
        soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(from, env),
        soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(to, env),
        soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&amount, env),
    ];
    env.invoke_contract::<()>(token, &soroban_sdk::Symbol::new(env, "transfer"), args);
}

/// Check if the contract treasury has enough balance of `asset` for a payout.
pub fn check_balance(env: &Env, asset: &Address, amount: i128) -> bool {
    let client = token::TokenClient::new(env, asset);
    client.balance(&env.current_contract_address()) >= amount
}
