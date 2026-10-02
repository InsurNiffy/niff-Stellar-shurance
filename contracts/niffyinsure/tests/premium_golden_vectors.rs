//! Golden vectors for `premium_pure::compute_premium` (issue #1428).
//!
//! The committed file `testdata/golden-vectors.json` is the contract between
//! the on-chain engine and the backend / `premium_calculator`. This test fails
//! if output drifts.

#![cfg(test)]

use niffyinsure::{
    premium_pure::{compute_premium, validate_table},
    types::{AgeBand, CoverageTier, RegionTier, RiskInput},
    NiffyInsureClient,
};
use soroban_sdk::{testutils::Address as _, Address, Env};
use std::fs;
use std::path::PathBuf;

fn testdata_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("testdata/golden-vectors.json")
}

fn parse_region(s: &str) -> RegionTier {
    match s {
        "Low" => RegionTier::Low,
        "Medium" => RegionTier::Medium,
        "High" => RegionTier::High,
        other => panic!("unknown region {other}"),
    }
}

fn parse_age(s: &str) -> AgeBand {
    match s {
        "Young" => AgeBand::Young,
        "Adult" => AgeBand::Adult,
        "Senior" => AgeBand::Senior,
        other => panic!("unknown age {other}"),
    }
}

fn parse_coverage(s: &str) -> CoverageTier {
    match s {
        "Basic" => CoverageTier::Basic,
        "Standard" => CoverageTier::Standard,
        "Premium" => CoverageTier::Premium,
        other => panic!("unknown coverage {other}"),
    }
}

#[test]
fn golden_vectors_match_compute_premium_bit_for_bit() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);

    let table = client.get_multiplier_table();
    validate_table(&table).expect("default table must validate");

    let raw = fs::read_to_string(testdata_path()).expect("golden-vectors.json must be committed");
    let json: serde_json::Value =
        serde_json::from_str(&raw).expect("golden-vectors.json must be valid JSON");
    let vectors = json["vectors"].as_array().expect("vectors array");
    assert!(!vectors.is_empty(), "golden file must contain vectors");

    for v in vectors {
        let id = v["id"].as_str().unwrap();
        let input = RiskInput {
            region: parse_region(v["region"].as_str().unwrap()),
            age_band: parse_age(v["age_band"].as_str().unwrap()),
            coverage: parse_coverage(v["coverage"].as_str().unwrap()),
            safety_score: v["safety_score"].as_u64().unwrap() as u32,
        };
        let base = v["base"].as_i64().unwrap() as i128;
        let expected = v["expected_premium"].as_i64().unwrap() as i128;
        let got = compute_premium(&input, base, &table)
            .unwrap_or_else(|e| panic!("{id}: compute failed: {e:?}"))
            .total_premium;
        assert_eq!(
            got, expected,
            "golden vector `{id}` drifted: got {got}, expected {expected}"
        );
    }
}
