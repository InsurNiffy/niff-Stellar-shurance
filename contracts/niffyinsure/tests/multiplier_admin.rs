#![cfg(test)]

//! #1429 Multiplier table administration: validation, per-asset override,
//! version counter, and existing-policy premium isolation.

use niffyinsure::{
    types::{
        AgeBand, CoverageTier, InitiatePolicyOptions, MultiplierKey, MultiplierTable, PolicyType,
        RegionTier, RiskInput,
    },
    NiffyInsureClient,
};
use soroban_sdk::{
    map,
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

fn make_table(
    env: &Env,
    region_value: i128,
    age_value: i128,
    coverage_value: i128,
    safety_discount: i128,
    version: u32,
) -> MultiplierTable {
    MultiplierTable {
        region: map![
            env,
            (RegionTier::Low, region_value),
            (RegionTier::Medium, region_value),
            (RegionTier::High, region_value)
        ],
        age: map![
            env,
            (AgeBand::Young, age_value),
            (AgeBand::Adult, age_value),
            (AgeBand::Senior, age_value)
        ],
        coverage: map![
            env,
            (CoverageTier::Basic, coverage_value),
            (CoverageTier::Standard, coverage_value),
            (CoverageTier::Premium, coverage_value)
        ],
        safety_discount,
        version,
    }
}

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 200);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();
    client.initialize(&admin, &token);
    client.set_allowed_asset(&token, &true, &String::from_str(&env, "USDC"), &7u32);
    (env, client, admin, token)
}

fn fund_holder(env: &Env, client: &NiffyInsureClient<'_>, token: &Address, holder: &Address) {
    token::StellarAssetClient::new(env, token).mint(holder, &100_000_000_000i128);
    token::Client::new(env, token).approve(
        holder,
        &client.address,
        &100_000_000_000i128,
        &(env.ledger().sequence() + 50_000),
    );
}

#[test]
fn invalid_table_rejected_by_validate_table() {
    let (env, client, _, _) = setup();
    let before = client.get_multiplier_table();
    let invalid = make_table(&env, 4_999, 10_000, 10_000, 2_000, before.version + 1);
    assert!(client.try_update_multiplier_table(&invalid).is_err());
    assert_eq!(client.get_multiplier_table(), before);
}

#[test]
fn version_increments_on_global_and_granular_updates() {
    let (env, client, _, _) = setup();
    let v0 = client.get_multiplier_table().version;

    let updated = make_table(&env, 10_500, 10_000, 10_000, 2_000, v0 + 1);
    client.update_multiplier_table(&updated);
    assert_eq!(client.get_multiplier_table().version, v0 + 1);

    client.admin_set_premium_multiplier(&MultiplierKey::Region(RegionTier::High), &15_000);
    let after = client.get_multiplier_table();
    assert!(
        after.version > v0 + 1,
        "granular update must bump table version counter"
    );
    assert_eq!(after.region.get(RegionTier::High), Some(15_000));
}

#[test]
fn per_asset_table_overrides_global_for_new_quotes() {
    let (env, client, _, token) = setup();

    let global_before = client
        .generate_premium_for_asset(
            &RiskInput {
                region: RegionTier::Medium,
                age_band: AgeBand::Adult,
                coverage: CoverageTier::Standard,
                safety_score: 0,
            },
            &10_000_000i128,
            &false,
            &token,
        )
        .premium;

    let asset_table = make_table(&env, 20_000, 10_000, 10_000, 0, 1);
    client.admin_set_asset_premium_table(&token, &Some(asset_table));

    let stored = client.get_asset_premium_table(&token);
    assert!(stored.is_some());
    assert_eq!(stored.unwrap().version, 1);

    let asset_quote = client
        .generate_premium_for_asset(
            &RiskInput {
                region: RegionTier::Medium,
                age_band: AgeBand::Adult,
                coverage: CoverageTier::Standard,
                safety_score: 0,
            },
            &10_000_000i128,
            &false,
            &token,
        )
        .premium;

    assert!(
        asset_quote > global_before,
        "per-asset override must raise premium vs global ({asset_quote} vs {global_before})"
    );

    let global_after = client
        .generate_premium(
            &RiskInput {
                region: RegionTier::Medium,
                age_band: AgeBand::Adult,
                coverage: CoverageTier::Standard,
                safety_score: 0,
            },
            &10_000_000i128,
            &false,
        )
        .premium;
    assert_eq!(global_after, global_before);
}

#[test]
fn existing_policies_keep_bound_premium_after_table_update() {
    let (env, client, _, token) = setup();
    let holder = Address::generate(&env);
    fund_holder(&env, &client, &token, &holder);

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &50u32,
        &10_000_000i128,
        &token,
        &InitiatePolicyOptions::test_defaults(&env),
    );
    let bound_premium = policy.premium;
    assert!(bound_premium > 0);

    let v = client.get_multiplier_table().version;
    let expensive = make_table(&env, 20_000, 20_000, 20_000, 0, v + 1);
    client.update_multiplier_table(&expensive);

    let new_quote = client
        .generate_premium(
            &RiskInput {
                region: RegionTier::Medium,
                age_band: AgeBand::Adult,
                coverage: CoverageTier::Standard,
                safety_score: 50,
            },
            &10_000_000i128,
            &false,
        )
        .premium;
    assert!(new_quote > bound_premium);

    let fetched = client.get_policy(&holder, &policy.policy_id).unwrap();
    assert_eq!(fetched.premium, bound_premium);
}
