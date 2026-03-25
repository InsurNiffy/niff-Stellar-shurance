//! Cross-contract client for the external PremiumCalculator contract.
//!
//! When a calculator address is configured the policy contract delegates all
//! premium computation to it.  If the calculator is paused or the call fails
//! the error is propagated faithfully — bind fails closed.
//!
//! When no calculator address is stored the contract falls back to the
//! built-in `premium::compute_premium` logic so existing deployments keep
//! working without migration.

use soroban_sdk::{contractclient, Address, Env};

use crate::{
    premium,
    storage,
    types::{AgeBand, CoverageType, PremiumQuote, RegionTier, RiskInput},
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

// ── contractclient! binding ───────────────────────────────────────────────────

/// Generated client for the PremiumCalculator contract.
#[contractclient(name = "PremiumCalculatorClient")]
pub trait PremiumCalculatorTrait {
    fn compute(env: Env, input: CalcInput) -> Result<CalcResult, soroban_sdk::Error>;
    fn get_version(env: Env) -> u32;
}

// ── Public helper ─────────────────────────────────────────────────────────────

/// Compute a premium quote, routing to the external calculator when configured.
///
/// Routing logic:
/// - If `CalcAddress` is set → cross-contract call; errors bubble up as
///   `CalculatorCallFailed` (or `CalculatorPaused` for CalcError::Paused = 17).
/// - If `CalcAddress` is absent → local `premium::compute_premium` fallback.
pub fn compute_quote(
    env: &Env,
    input: &RiskInput,
    base_amount: i128,
    include_breakdown: bool,
    quote_ttl: u32,
) -> Result<PremiumQuote, Error> {
    match storage::get_calc_address(env) {
        Some(calc_addr) => call_external(env, &calc_addr, input, base_amount, quote_ttl),
        None => call_local(env, input, base_amount, include_breakdown, quote_ttl),
    }
}

fn call_external(
    env: &Env,
    calc_addr: &Address,
    input: &RiskInput,
    base_amount: i128,
    quote_ttl: u32,
) -> Result<PremiumQuote, Error> {
    let client = PremiumCalculatorClient::new(env, calc_addr);
    let calc_input = to_calc_input(input, base_amount);

    // try_compute returns:
    //   Ok(Ok(CalcResult))          — success
    //   Ok(Err(conversion_err))     — type conversion failure (treat as call failed)
    //   Err(Ok(CalcError))          — calculator returned a typed error
    //   Err(Err(InvokeError))       — host-level abort / panic
    let result = client.try_compute(&calc_input).map_err(|outer_err| {
        match outer_err {
            // Typed contract error — distinguish Paused (code 17) from others
            Ok(calc_err) => {
                use soroban_sdk::InvokeError;
                // CalcError is a contracterror; convert to InvokeError to read code
                let invoke: InvokeError = calc_err.into();
                match invoke {
                    InvokeError::Contract(17) => Error::CalculatorPaused,
                    _ => Error::CalculatorCallFailed,
                }
            }
            // Host abort / panic
            Err(_) => Error::CalculatorCallFailed,
        }
    })?;

    // Inner Ok: successful deserialization of CalcResult
    let calc_result = result.map_err(|_| Error::CalculatorCallFailed)?;

    let current_ledger = env.ledger().sequence();
    let valid_until_ledger = current_ledger
        .checked_add(quote_ttl)
        .ok_or(Error::Overflow)?;

    Ok(PremiumQuote {
        total_premium: calc_result.premium,
        line_items: None, // external calculator does not return line items
        valid_until_ledger,
        config_version: calc_result.config_version,
    })
}

fn call_local(
    env: &Env,
    input: &RiskInput,
    base_amount: i128,
    include_breakdown: bool,
    quote_ttl: u32,
) -> Result<PremiumQuote, Error> {
    let table = storage::get_multiplier_table(env);
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

// ── Type conversion ───────────────────────────────────────────────────────────

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
            CoverageType::Basic => CalcCoverageType::Basic,
            CoverageType::Standard => CalcCoverageType::Standard,
            CoverageType::Premium => CalcCoverageType::Premium,
        },
        safety_score: input.safety_score,
        base_amount,
    }
}
