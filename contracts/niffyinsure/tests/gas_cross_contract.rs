//! Cross-contract call gas accounting (Issue #1160).
//!
//! The main `gas_benchmarks` suite measures CPU instructions per entrypoint, but
//! it does not isolate the extra cost niffyinsure pays when it delegates premium
//! computation to the *external* `premium_calculator` contract instead of running
//! the local `premium_pure` calculation.
//!
//! This benchmark measures both paths with identical risk inputs and reports:
//!   - `cross_contract` — CPU for a `premium_calculator.compute()` cross-contract call.
//!   - `local`          — CPU for the equivalent `premium_pure::compute_premium()` call.
//!   - `delta`          — the cross-contract overhead (cross_contract - local).
//!
//! The numbers are printed each run (use `-- --nocapture`) so they act as a
//! baseline that is comparable across future runs and reviewable in CI logs. The
//! documented delta is computed at runtime, so it always matches the measured
//! results. The invariant asserted below — the cross-contract path is strictly
//! more expensive than the local path — is the stable regression guard: if a
//! change ever makes the cross-contract call cheaper than a local computation,
//! something about the call path has regressed.
//!
//! Run: cargo test --test gas_cross_contract --features testutils -- --nocapture

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use niffyinsure::{
    premium_pure,
    types::{AgeBand, CoverageTier, RegionTier, RiskInput},
    NiffyInsureClient,
};
use premium_calculator::{
    types::{
        AgeBand as CalcAgeBand, CalcInput, CoverageTier as CalcCoverageTier,
        RegionTier as CalcRegionTier,
    },
    PremiumCalculator, PremiumCalculatorClient,
};

const BASE_AMOUNT: i128 = 10_000_000;
const SAFETY_SCORE: u32 = 50;

fn cpu(env: &Env) -> u64 {
    env.cost_estimate().budget().cpu_instruction_cost()
}

#[test]
fn bench_cross_contract_vs_local_calculator() {
    let env = Env::default();
    env.mock_all_auths();

    // ── Local path setup: a niffyinsure instance to source the default table. ──
    let ni_contract = env.register(niffyinsure::NiffyInsure, ());
    let ni_client = NiffyInsureClient::new(&env, &ni_contract);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    ni_client.initialize(&admin, &token);
    let table = ni_client.get_multiplier_table();

    let local_input = RiskInput {
        region: RegionTier::Medium,
        age_band: AgeBand::Adult,
        coverage: CoverageTier::Standard,
        safety_score: SAFETY_SCORE,
    };

    // ── Cross-contract path setup: the external premium_calculator contract. ──
    let calc_contract = env.register(PremiumCalculator, ());
    let calc_client = PremiumCalculatorClient::new(&env, &calc_contract);
    let calc_admin = Address::generate(&env);
    calc_client.initialize(&calc_admin);

    let calc_input = CalcInput {
        region: CalcRegionTier::Medium,
        age_band: CalcAgeBand::Adult,
        coverage: CalcCoverageTier::Standard,
        safety_score: SAFETY_SCORE,
        base_amount: BASE_AMOUNT,
    };

    // Warm both paths once so setup/first-call costs are excluded from the measurement.
    let _ = premium_pure::compute_premium(&local_input, BASE_AMOUNT, &table).unwrap();
    let _ = calc_client.compute(&calc_input);

    // Measure the local pure-computation path.
    let before = cpu(&env);
    let _ = premium_pure::compute_premium(&local_input, BASE_AMOUNT, &table).unwrap();
    let local_cpu = cpu(&env) - before;

    // Measure the cross-contract calculator call path.
    let before = cpu(&env);
    let _ = calc_client.compute(&calc_input);
    let cross_cpu = cpu(&env) - before;

    let delta = cross_cpu.saturating_sub(local_cpu);
    println!("  premium_calc.cross_contract {cross_cpu:>12} CPU");
    println!("  premium_pure.local          {local_cpu:>12} CPU");
    println!("  cross_contract_overhead     {delta:>12} CPU  (delta)");

    assert!(
        cross_cpu > local_cpu,
        "cross-contract call ({cross_cpu}) should cost more than local computation ({local_cpu})",
    );
}
