//! Gas benchmark suite — measures CPU instruction consumption per contract
//! entrypoint using the Soroban test environment.
//!
//! Each test records the CPU instructions consumed by a single call and asserts
//! that the count does not regress by more than 10 % from the stored baseline.
//! The baseline values are maintained in `contracts/gas-baseline.json`.
//!
//! Run: cargo test --test gas_benchmarks --features testutils -- --nocapture

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use niffyinsure::NiffyInsureClient;

/// Load the baseline map from the JSON sidecar file.
fn load_baseline() -> serde_json::Value {
    let path = std::env::current_dir()
        .unwrap()
        .join("contracts")
        .join("gas-baseline.json");
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("baseline file not found at {path:?}"));
    serde_json::from_str(&text).expect("invalid baseline JSON")
}

/// At the end of each benchmark we compare the recorded CPU instructions
/// against the baseline. If the delta exceeds +10 % the test fails.
fn assert_within_budget(entrypoint: &str, instructions: u64, baseline: &serde_json::Value) {
    let baseline_val = baseline
        .get(entrypoint)
        .and_then(|v| v.as_u64())
        .unwrap_or_else(|| panic!("baseline missing for entrypoint \"{entrypoint}\""));

    let max_allowed = (baseline_val as f64 * 1.10).ceil() as u64;
    assert!(
        instructions <= max_allowed,
        "{}: {instructions} CPU instructions exceeds 110 % of baseline {baseline_val} (max {max_allowed})",
        entrypoint,
    );

    // Print for visible CI output.
    let pct = if instructions > baseline_val {
        format!(
            "+{:.1} %",
            (instructions as f64 / baseline_val as f64 - 1.0) * 100.0
        )
    } else {
        format!(
            "{:.1} %",
            (instructions as f64 / baseline_val as f64) * 100.0
        )
    };
    println!("  {entrypoint:60} {instructions:>10} CPU  (baseline {baseline_val:>10}, {pct})");
}

/// Shared setup: returns (env, client, admin, token).
fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    (env, client, admin, token)
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

#[test]
fn bench_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    client.initialize(&admin, &token);
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("initialize", after - before, &baseline);
}

#[test]
fn bench_version() {
    let env = Env::default();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.version();
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("version", after - before, &baseline);
}

#[test]
fn bench_get_admin() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_admin();
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_admin", after - before, &baseline);
}

#[test]
fn bench_get_wasm_hash() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_wasm_hash();
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_wasm_hash", after - before, &baseline);
}

#[test]
fn bench_get_treasury_balance() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_treasury_balance();
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_treasury_balance", after - before, &baseline);
}

#[test]
fn bench_get_protocol_fee_bps() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_protocol_fee_bps();
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_protocol_fee_bps", after - before, &baseline);
}

#[test]
fn bench_generate_premium() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);

    let input = niffyinsure::types::RiskInput {
        region: niffyinsure::types::RegionTier::Medium,
        age_band: niffyinsure::types::AgeBand::Adult,
        coverage: niffyinsure::types::CoverageTier::Standard,
        safety_score: 50,
    };

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.generate_premium(&input, &10_000_000i128, &false);
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("generate_premium", after - before, &baseline);
}

#[test]
fn bench_set_allowed_asset() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let asset = Address::generate(&env);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    client.set_allowed_asset(
        &asset,
        &true,
        &soroban_sdk::String::from_str(&env, "ASSET"),
        &6u32,
    );
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("set_allowed_asset", after - before, &baseline);
}

#[test]
fn bench_is_allowed_asset() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let asset = Address::generate(&env);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.is_allowed_asset(&asset);
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("is_allowed_asset", after - before, &baseline);
}

#[test]
fn bench_get_vote_duration_ledgers() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_vote_duration_ledgers();
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_vote_duration_ledgers", after - before, &baseline);
}

#[test]
fn bench_get_quorum_bps() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_quorum_bps();
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_quorum_bps", after - before, &baseline);
}

#[test]
fn bench_get_grace_period_ledgers() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_grace_period_ledgers();
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_grace_period_ledgers", after - before, &baseline);
}

#[test]
fn bench_get_claim_counter() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_claim_counter();
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_claim_counter", after - before, &baseline);
}

#[test]
fn bench_get_policy_counter() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let holder = Address::generate(&env);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_policy_counter(&holder);
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_policy_counter", after - before, &baseline);
}

#[test]
fn bench_has_policy() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let holder = Address::generate(&env);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.has_policy(&holder, &1u32);
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("has_policy", after - before, &baseline);
}

#[test]
fn bench_voter_registry_len() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.voter_registry_len();
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("voter_registry_len", after - before, &baseline);
}

#[test]
fn bench_voter_registry_contains() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let holder = Address::generate(&env);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.voter_registry_contains(&holder);
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("voter_registry_contains", after - before, &baseline);
}

#[test]
fn bench_get_nonce() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let holder = Address::generate(&env);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_nonce(&holder);
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_nonce", after - before, &baseline);
}

#[test]
fn bench_get_voters() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_voters();
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_voters", after - before, &baseline);
}

#[test]
fn bench_get_active_policy_count() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let holder = Address::generate(&env);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_active_policy_count(&holder);
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_active_policy_count", after - before, &baseline);
}

#[test]
fn bench_get_calculator() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_calculator();
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_calculator", after - before, &baseline);
}

#[test]
fn bench_get_fee_recipient() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_fee_recipient();
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_fee_recipient", after - before, &baseline);
}

#[test]
fn bench_get_min_solvency_ratio_bps() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_min_solvency_ratio_bps();
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_min_solvency_ratio_bps", after - before, &baseline);
}

#[test]
fn bench_get_multiplier_table() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.get_multiplier_table();
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("get_multiplier_table", after - before, &baseline);
}

#[test]
fn bench_holder_active_policy_count() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let holder = Address::generate(&env);

    let before = env.cost_estimate().budget().cpu_instruction_cost();
    let _ = client.holder_active_policy_count(&holder);
    let after = env.cost_estimate().budget().cpu_instruction_cost();

    let baseline = load_baseline();
    assert_within_budget("holder_active_policy_count", after - before, &baseline);
}
