use soroban_sdk::{contracttype, Address, Env};

use crate::types::{Config, ConfigUpdated, DataKey, Error};

const BPS_DENOMINATOR: u32 = 10_000;
const MAX_PROTOCOL_FEE_BPS: u32 = 2_000;

pub fn get_config(env: &Env) -> Config {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .unwrap_or_else(|| Config {
            min_solvency_ratio_bps: 0,
            min_coverage_amount: 0,
            protocol_fee_bps: 0,
            fee_recipient: env.current_contract_address(),
        })
}

fn set_config(env: &Env, config: &Config) {
    env.storage().instance().set(&DataKey::Config, config);
}

fn emit_config_updated(env: &Env, config: &Config) {
    env.events().publish(
        (soroban_sdk::symbol_short!("ConfigUpdated"),),
        ConfigUpdated {
            min_solvency_ratio_bps: config.min_solvency_ratio_bps,
            min_coverage_amount: config.min_coverage_amount,
            protocol_fee_bps: config.protocol_fee_bps,
            fee_recipient: config.fee_recipient.clone(),
        },
    );
}

pub fn admin_set_min_solvency_ratio_bps(env: &Env, bps: u32) -> Result<(), Error> {
    if bps > BPS_DENOMINATOR {
        return Err(Error::InvalidParameter);
    }
    let mut config = get_config(env);
    config.min_solvency_ratio_bps = bps;
    set_config(env, &config);
    emit_config_updated(env, &config);
    Ok(())
}

pub fn get_min_solvency_ratio_bps(env: &Env) -> u32 {
    get_config(env).min_solvency_ratio_bps
}

pub fn admin_set_min_coverage_amount(env: &Env, amount: i128) -> Result<(), Error> {
    if amount < 0 {
        return Err(Error::InvalidParameter);
    }
    let mut config = get_config(env);
    config.min_coverage_amount = amount;
    set_config(env, &config);
    emit_config_updated(env, &config);
    Ok(())
}

pub fn admin_set_protocol_fee_bps(env: &Env, bps: u32) -> Result<(), Error> {
    if bps > MAX_PROTOCOL_FEE_BPS {
        return Err(Error::InvalidParameter);
    }
    let mut config = get_config(env);
    config.protocol_fee_bps = bps;
    set_config(env, &config);
    emit_config_updated(env, &config);
    Ok(())
}

pub fn admin_set_fee_recipient(env: &Env, recipient: Address) -> Result<(), Error> {
    let mut config = get_config(env);
    config.fee_recipient = recipient;
    set_config(env, &config);
    emit_config_updated(env, &config);
    Ok(())
}

/// Returns true when adding `new_coverage` keeps the protocol solvent.
/// Solvency: available_capital * BPS_DENOMINATOR >= (total_coverage + new_coverage) * min_ratio_bps
pub fn check_solvency_ratio(env: &Env, new_coverage: i128) -> Result<bool, Error> {
    if new_coverage < 0 {
        return Err(Error::InvalidParameter);
    }
    let config = get_config(env);
    let available_capital = get_available_capital(env);
    let total_coverage = get_total_coverage(env);

    let projected = total_coverage
        .checked_add(new_coverage)
        .ok_or(Error::Overflow)?;

    let lhs = available_capital
        .checked_mul(BPS_DENOMINATOR as i128)
        .ok_or(Error::Overflow)?;
    let rhs = projected
        .checked_mul(config.min_solvency_ratio_bps as i128)
        .ok_or(Error::Overflow)?;

    Ok(lhs >= rhs)
}

/// Splits a premium into (to_treasury, fee). Rounding is done so that
/// `to_treasury + fee == amount` exactly for all inputs.
pub fn split_premium(env: &Env, amount: i128) -> Result<(i128, i128), Error> {
    if amount < 0 {
        return Err(Error::InvalidParameter);
    }
    let config = get_config(env);
    let fee = amount
        .checked_mul(config.protocol_fee_bps as i128)
        .ok_or(Error::Overflow)?
        / (BPS_DENOMINATOR as i128);
    let to_treasury = amount.checked_sub(fee).ok_or(Error::Overflow)?;
    Ok((to_treasury, fee))
}

fn get_available_capital(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::AvailableCapital)
        .unwrap_or(0)
}

fn get_total_coverage(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalCoverage)
        .unwrap_or(0)
}
