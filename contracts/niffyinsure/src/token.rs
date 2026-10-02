/// Token interaction helpers using SEP-41 Token interface.
///
/// # Trust model
/// Only allowlisted asset contract IDs may be used in payment paths.
/// `transfer_from_contract` reads the stored default token address.
/// `transfer` (used by the policy path) validates the asset is allowlisted
/// before invoking the SEP-41 contract — no arbitrary token substitution.
/// See SECURITY.md for the full trust model and reentrancy analysis.
///
/// # Checks-effects-interactions (issues #1426)
///
/// [`transfer_in`] / [`transfer_out`] update internal [`crate::ledger`] counters
/// **before** the SEP-41 host call. Soroban limits classic EVM-style re-entrancy
/// (a failed host call aborts the transaction, rolling back storage), but CEI
/// still matters for indexer consistency and future cross-contract callbacks.
use soroban_sdk::{token, Address, Env};

use crate::ledger;
use crate::storage;
use crate::validate::Error;

/// Pull `amount` of `asset` from `from` into this contract via SEP-41 `transfer`.
///
/// Validates `amount > 0` and that `asset` is allowlisted. Updates internal
/// `treasury_balance` (effects) before the host transfer (interactions).
/// Used by authorized treasury deposits.
pub fn transfer_in(
    env: &Env,
    from: &Address,
    asset: &Address,
    amount: i128,
) -> Result<(), Error> {
    if amount <= 0 {
        return Err(Error::ZeroTreasuryDeposit);
    }
    if !storage::is_allowed_asset(env, asset) {
        return Err(Error::InvalidAsset);
    }

    // Effects
    ledger::record_deposit(env, asset, amount)?;

    // Interactions
    let client = token::TokenClient::new(env, asset);
    client.transfer(from, &env.current_contract_address(), &amount);
    Ok(())
}

/// Send `amount` of `asset` from this contract to `to` via SEP-41 `transfer`.
///
/// Validates `amount > 0`. Updates internal counters (effects) before the host
/// transfer (interactions). `release_reserved` optionally reduces reserved coverage.
#[allow(dead_code)]
pub fn transfer_out(
    env: &Env,
    to: &Address,
    asset: &Address,
    amount: i128,
    release_reserved: i128,
) -> Result<(), Error> {
    if amount <= 0 {
        return Err(Error::ClaimAmountZero);
    }

    // Effects
    ledger::record_payout_out(env, asset, amount, release_reserved)?;

    // Interactions
    let client = token::TokenClient::new(env, asset);
    client.transfer(&env.current_contract_address(), to, &amount);
    Ok(())
}

/// Collect `amount` of the policy's asset from `from` via allowance.
///
/// CEI: credits internal premium counters before `transfer_from`.
pub fn collect_premium(env: &Env, from: &Address, asset: &Address, amount: i128) {
    if amount <= 0 {
        return;
    }
    let _ = ledger::record_premium_in(env, asset, amount);
    let treasury = storage::get_treasury(env);
    let client = token::TokenClient::new(env, asset);
    client.transfer_from(&env.current_contract_address(), from, &treasury, &amount);
}

/// Collect a premium and split it between treasury and protocol fee recipient.
///
/// CEI: credits internal premium counters for the treasury portion before any
/// `transfer_from` host calls.
pub fn collect_premium_with_fee(
    env: &Env,
    from: &Address,
    asset: &Address,
    treasury_amount: i128,
    fee_recipient: &Address,
    fee_amount: i128,
) {
    let client = token::TokenClient::new(env, asset);
    let spender = &env.current_contract_address();
    let treasury = storage::get_treasury(env);

    // Effects first for the treasury portion (CEI).
    if treasury_amount > 0 {
        let _ = ledger::record_premium_in(env, asset, treasury_amount);
    }

    // Interactions
    if treasury_amount > 0 {
        client.transfer_from(spender, from, &treasury, &treasury_amount);
    }
    if fee_amount > 0 {
        client.transfer_from(spender, from, fee_recipient, &fee_amount);
    }
}

/// Transfer `amount` of the contract's default treasury token from this contract to `to`.
/// Used for admin drain operations.
pub fn transfer_from_contract(env: &Env, to: &Address, amount: i128) {
    let token_addr = storage::get_token(env);
    let client = token::TokenClient::new(env, &token_addr);
    client.transfer(&env.current_contract_address(), to, &amount);
}

/// Refund a previously-collected claim filing fee back to `to` in `asset`.
/// Draws from the contract's own balance, mirroring the outgoing-transfer
/// pattern used by claim payouts (`claim::payout`), since fee collection
/// deposits into the configured treasury which is expected to route back
/// through the contract's holdings for this asset.
pub fn refund_fee(env: &Env, to: &Address, asset: &Address, amount: i128) {
    let client = token::TokenClient::new(env, asset);
    client.transfer(&env.current_contract_address(), to, &amount);
}

/// Low-level SEP-41 `transfer` invocation for a specific allowlisted asset.
///
/// Defence-in-depth: verifies `token` is on the allowlist before invoking.
/// `pub(crate)` — callers in the policy path must have already validated the asset.
#[allow(dead_code)]
pub(crate) fn transfer(env: &Env, token: &Address, from: &Address, to: &Address, amount: i128) {
    if !storage::is_allowed_asset(env, token) {
        panic!("token not allowlisted");
    }
    invoke_transfer(env, token, from, to, amount);
}

/// SEP-41 transfer for an asset that was valid at policy bind time.
///
/// Used by payout / refund paths so **delisting does not break existing
/// policies** (issue #1425). Does not consult the allowlist.
pub(crate) fn transfer_bound_asset(
    env: &Env,
    token: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
) {
    invoke_transfer(env, token, from, to, amount);
}

fn invoke_transfer(env: &Env, token: &Address, from: &Address, to: &Address, amount: i128) {
    let args = soroban_sdk::vec![
        env,
        soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(from, env),
        soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(to, env),
        soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&amount, env),
    ];
    env.invoke_contract::<()>(token, &soroban_sdk::Symbol::new(env, "transfer"), args);
}

/// Check if the contract treasury has enough balance of `asset` for a payout.
#[allow(dead_code)]
pub fn check_balance(env: &Env, asset: &Address, amount: i128) -> bool {
    let client = token::TokenClient::new(env, asset);
    client.balance(&env.current_contract_address()) >= amount
}

/// Get the current balance of `asset` held by the contract.
pub fn get_balance(env: &Env, asset: &Address) -> i128 {
    let client = token::TokenClient::new(env, asset);
    client.balance(&env.current_contract_address())
}

/// Pre-flight check: how much of `asset` has `owner` approved this contract
/// to spend via `transfer_from`. Used to surface a friendly
/// `InsufficientAllowance` error at `initiate_policy` instead of letting the
/// SEP-41 `transfer_from` call trap with an opaque host error.
pub fn get_allowance(env: &Env, asset: &Address, owner: &Address) -> i128 {
    let client = token::TokenClient::new(env, asset);
    client.allowance(owner, &env.current_contract_address())
}

/// Get the current SEP-41 balance of `asset` held by the configured treasury address.
pub fn get_treasury_balance(env: &Env, asset: &Address) -> i128 {
    let treasury = storage::get_treasury(env);
    let client = token::TokenClient::new(env, asset);
    client.balance(&treasury)
}

/// Emergency sweep: transfer `amount` of `asset` from contract to `recipient`.
/// Used only by admin sweep_token() / admin_sweep() with strict validation.
pub fn sweep_asset(env: &Env, asset: &Address, recipient: &Address, amount: i128) {
    let client = token::TokenClient::new(env, asset);
    client.transfer(&env.current_contract_address(), recipient, &amount);
}

/// Draw `amount` of `asset` from the reinsurance pool contract to `recipient`.
/// Uses transfer_from so the reinsurance contract must have approved this contract.
pub(crate) fn transfer_from_reinsurance(
    env: &Env,
    asset: &Address,
    reinsurance: &Address,
    recipient: &Address,
    amount: i128,
) {
    let client = token::TokenClient::new(env, asset);
    client.transfer_from(
        &env.current_contract_address(),
        reinsurance,
        recipient,
        &amount,
    );
}
