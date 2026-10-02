//! Cross-contract client for the external PremiumCalculator contract.
//!
//! # Failure behaviour (fail-open with alert)
//!
//! Decision: **fail-open to the in-contract engine**, never mis-price from a
//! broken/paused/wrong-ABI calculator.
//!
//! When a calculator address is configured the policy contract prefers the
//! external `compute`. If that call fails — pause, ABI mismatch, host abort,
//! unreachable address, or typed calc error — the contract **falls back** to
//! the local `premium::compute_premium` engine and emits
//! [`CalculatorFallback`] so operators can alert. This keeps quotes and binds
//! available while making degradation visible.
//!
//! ## Why fail-open (not fail-closed)
//!
//! - Mis-pricing from a wrong ABI or paused calculator is worse than using the
//!   audited local engine with an explicit ops signal.
//! - Fail-closed would hard-stop all binds/quotes during calculator outages.
//! - The `CalculatorFallback` event gives SRE the same signal a hard error
//!   would, without stranding policyholders.
//!
//! Local `premium::compute_premium` is also used when no calculator address is
//! stored (default / pre-migration deployments).
//!
//! # ABI version pin
//!
//! Integrators should pin against `PremiumCalculator::abi_version()` (stable
//! `u32`). On each successful external `compute` during a bind path, this
//! contract may record that ABI version (`get_last_calc_abi_version`). Admins
//! set an expected ABI via `set_calculator_with_version`; mismatches trigger
//! fallback (not a hard error).
//!
//! Quote paths pass `persist_abi = false` so simulation-friendly reads never
//! write instance storage.

use soroban_sdk::{contractclient, contractevent, Address, Env};

use crate::{
    premium, storage,
    types::{AgeBand, CalcSource, CoverageTier, PremiumQuote, RegionTier, RiskInput},
    validate::Error,
};

// ── Mirrored types from premium_calculator ────────────────────────────────────
// These must stay structurally identical to `premium_calculator::types`.

use soroban_sdk::contracttype;

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum CalcRegionTier {
    Low,
    Medium,
    High,
}

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum CalcAgeBand {
    Young,
    Adult,
    Senior,
}

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum CalcCoverageType {
    Basic,
    Standard,
    Premium,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CalcInput {
    pub region: CalcRegionTier,
    pub age_band: CalcAgeBand,
    pub coverage: CalcCoverageType,
    pub safety_score: u32,
    pub base_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CalcResult {
    pub premium: i128,
    pub config_version: u32,
}

/// Emitted when the contract falls back from an external calculator to the
/// in-contract premium engine. Ops should alert on this event.
#[contractevent(topics = ["niffyinsure", "calculator_fallback"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CalculatorFallback {
    /// Why the external path was abandoned (stable short tag).
    pub reason: soroban_sdk::Symbol,
    pub calculator: Address,
}

// ── contractclient! binding ───────────────────────────────────────────────────

/// Generated client for the PremiumCalculator contract.
#[contractclient(name = "PremiumCalculatorClient")]
#[allow(dead_code)]
pub trait PremiumCalculatorTrait {
    fn compute(env: Env, input: CalcInput) -> Result<CalcResult, soroban_sdk::Error>;
    fn get_version(env: Env) -> u32;
    fn abi_version(env: Env) -> u32;
    fn version(env: Env) -> soroban_sdk::String;
}

// ── Calculator versioning ─────────────────────────────────────────────────────

const CALC_EXPECTED_VERSION_KEY: &str = "calc_exp_ver";
const CALC_LAST_ABI_VERSION_KEY: &str = "calc_last_abi";

pub fn set_expected_calc_version(env: &Env, version: u32) {
    storage::set_expected_calc_version(env, version);
}

pub fn get_expected_calc_version(env: &Env) -> Option<u32> {
    storage::get_expected_calc_version(env)
}

pub fn clear_expected_calc_version(env: &Env) {
    storage::clear_expected_calc_version(env);
}

fn set_last_calc_abi_version(env: &Env, version: u32) {
    storage::set_last_calc_abi_version(env, version);
}

pub fn get_last_calc_abi_version(env: &Env) -> Option<u32> {
    storage::get_last_calc_abi_version(env)
}

/// Admin helper: atomically update the calculator contract address and expected ABI version.
pub fn set_calculator_with_version(env: &Env, calculator: &Address, expected_version: u32) {
    storage::set_calc_address(env, calculator);
    if expected_version == 0 {
        clear_expected_calc_version(env);
    } else {
        set_expected_calc_version(env, expected_version);
    }
}

// ── Public helper ─────────────────────────────────────────────────────────────

/// Compute a premium quote, routing to the external calculator when configured.
///
/// Returns `(quote, source)` so callers can surface `calc_source` on
/// [`crate::types::QuoteResult`].
///
/// `persist_abi`: when `true` (bind path), records last successful ABI version.
/// When `false` (read-only quote / simulation), never writes storage.
pub fn compute_quote(
    env: &Env,
    input: &RiskInput,
    base_amount: i128,
    include_breakdown: bool,
    quote_ttl: u32,
    asset: Option<&Address>,
) -> Result<PremiumQuote, Error> {
    let (quote, _) = compute_quote_with_source(
        env,
        input,
        base_amount,
        include_breakdown,
        quote_ttl,
        asset,
        true,
    )?;
    Ok(quote)
}

/// Read-only quote path: never persists calculator ABI metadata.
pub fn compute_quote_readonly(
    env: &Env,
    input: &RiskInput,
    base_amount: i128,
    include_breakdown: bool,
    quote_ttl: u32,
    asset: Option<&Address>,
) -> Result<(PremiumQuote, CalcSource), Error> {
    compute_quote_with_source(
        env,
        input,
        base_amount,
        include_breakdown,
        quote_ttl,
        asset,
        false,
    )
}

fn compute_quote_with_source(
    env: &Env,
    input: &RiskInput,
    base_amount: i128,
    include_breakdown: bool,
    quote_ttl: u32,
    asset: Option<&Address>,
    persist_abi: bool,
) -> Result<(PremiumQuote, CalcSource), Error> {
    match storage::get_calc_address(env) {
        Some(calc_addr) => {
            match try_call_external(env, &calc_addr, input, base_amount, quote_ttl, persist_abi) {
                Ok(quote) => Ok((quote, CalcSource::External)),
                Err(reason) => {
                    emit_fallback(env, &calc_addr, reason);
                    let quote =
                        call_local(env, input, base_amount, include_breakdown, quote_ttl, asset)?;
                    Ok((quote, CalcSource::Local))
                }
            }
        }
        None => {
            let quote = call_local(env, input, base_amount, include_breakdown, quote_ttl, asset)?;
            Ok((quote, CalcSource::Local))
        }
    }
}

fn emit_fallback(env: &Env, calculator: &Address, reason: &'static str) {
    CalculatorFallback {
        reason: soroban_sdk::Symbol::new(env, reason),
        calculator: calculator.clone(),
    }
    .publish(env);
}

fn try_call_external(
    env: &Env,
    calc_addr: &Address,
    input: &RiskInput,
    base_amount: i128,
    quote_ttl: u32,
    persist_abi: bool,
) -> Result<PremiumQuote, &'static str> {
    let client = PremiumCalculatorClient::new(env, calc_addr);

    // try_* so a failing calculator never aborts the whole transaction.
    let actual_abi = match client.try_abi_version() {
        Ok(Ok(v)) => v,
        _ => return Err("call_failed"),
    };

    if let Some(expected_ver) = get_expected_calc_version(env) {
        if actual_abi != expected_ver {
            return Err("wrong_abi");
        }
    }

    let calc_input = to_calc_input(input, base_amount);

    let result = match client.try_compute(&calc_input) {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => return Err("call_failed"),
        Err(Ok(calc_err)) => {
            use soroban_sdk::InvokeError;
            let invoke: InvokeError = calc_err.into();
            match invoke {
                InvokeError::Contract(17) => return Err("paused"),
                _ => return Err("call_failed"),
            }
        }
        Err(Err(_)) => return Err("panicking"),
    };

    if persist_abi {
        set_last_calc_abi_version(env, actual_abi);
    }

    let current_ledger = env.ledger().sequence();
    let valid_until_ledger = current_ledger
        .checked_add(quote_ttl)
        .ok_or("call_failed")?;

    Ok(PremiumQuote {
        total_premium: result.premium,
        line_items: None,
        valid_until_ledger,
        config_version: result.config_version,
    })
}

fn call_local(
    env: &Env,
    input: &RiskInput,
    base_amount: i128,
    include_breakdown: bool,
    quote_ttl: u32,
    asset: Option<&Address>,
) -> Result<PremiumQuote, Error> {
    let table = match asset {
        Some(a) => premium::get_table_for_asset(env, a),
        None => storage::get_multiplier_table(env),
    };
    let computation = premium::compute_premium(input, base_amount, &table)?;
    let line_items = if include_breakdown {
        Some(premium::build_line_items(env, &computation))
    } else {
        None
    };
    let current_ledger = env.ledger().sequence();
    let valid_until_ledger = current_ledger
        .checked_add(quote_ttl)
        .ok_or(Error::Overflow)?;
    Ok(PremiumQuote {
        total_premium: computation.total_premium,
        line_items,
        valid_until_ledger,
        config_version: computation.config_version,
    })
}

fn to_calc_input(input: &RiskInput, base_amount: i128) -> CalcInput {
    CalcInput {
        region: match input.region {
            RegionTier::Low => CalcRegionTier::Low,
            RegionTier::Medium => CalcRegionTier::Medium,
            RegionTier::High => CalcRegionTier::High,
        },
        age_band: match input.age_band {
            AgeBand::Young => CalcAgeBand::Young,
            AgeBand::Adult => CalcAgeBand::Adult,
            AgeBand::Senior => CalcAgeBand::Senior,
        },
        coverage: match input.coverage {
            CoverageTier::Basic => CalcCoverageType::Basic,
            CoverageTier::Standard => CalcCoverageType::Standard,
            CoverageTier::Premium => CalcCoverageType::Premium,
        },
        safety_score: input.safety_score,
        base_amount,
    }
}
