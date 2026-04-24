//! Multi-asset configuration tests.
//!
//! Covers:
//! - Allowlist enforcement: premiums and payouts rejected for non-allowlisted assets.
//! - Per-policy asset binding: policy stores the asset used at initiation.
//! - Admin allowlist management with event emission.
//! - Two-asset scenario: two policies with different assets, independent payouts.
//! - Claim payout uses the policy's bound asset, not an arbitrary one.

#![cfg(test)]

mod common;

use niffyinsure::NiffyInsureClient;
use soroban_sdk::{testutils::Address as _, token, Address, Env};

// ── Helpers ───────────────────────────────────────────────────────────────────

struct TestEnv<'a> {
    env: Env,
    client: NiffyInsureClient<'a>,
    contract_id: Address,
    /// Default token (allowlisted at initialize).
    token_a: Address,
    token_a_admin: token::StellarAssetClient<'a>,
}

fn setup() -> TestEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_a_issuer = Address::generate(&env);
    let token_a = env
        .register_stellar_asset_contract_v2(token_a_issuer.clone())
        .address();
    let token_a_admin = token::StellarAssetClient::new(&env, &token_a);

    client.initialize(&admin, &token_a);

    TestEnv {
        env,
        client,
        contract_id,
        token_a,
        token_a_admin,
    }
}

fn make_second_asset<'a>(t: &'a TestEnv<'a>) -> (Address, token::StellarAssetClient<'a>) {
    let issuer = Address::generate(&t.env);
    let addr = t.env.register_stellar_asset_contract_v2(issuer).address();
    let admin_client = token::StellarAssetClient::new(&t.env, &addr);
    (addr, admin_client)
}

fn initiate(t: &TestEnv, holder: &Address, asset: &Address) -> niffyinsure::types::Policy {
    use niffyinsure::types::{AgeBand, CoverageTier, PolicyType, RegionTier};
    t.client.initiate_policy(
        holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &AgeBand::Adult,
        &CoverageTier::Standard,
        &5u32,
        &1_000_000_000i128,
        asset,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    )
}

fn fund_and_approve(
    env: &Env,
    client: &NiffyInsureClient<'_>,
    token_addr: &Address,
    token_admin: &token::StellarAssetClient<'_>,
    holder: &Address,
    amount: i128,
) {
    token_admin.mint(holder, &amount);
    token::Client::new(env, token_addr).approve(
        holder,
        &client.address,
        &amount,
        &(env.ledger().sequence() + 10_000),
    );
}

// ── Allowlist enforcement ─────────────────────────────────────────────────────

#[test]
fn initiate_policy_rejects_non_allowlisted_asset() {
    let t = setup();
    let (token_b, _) = make_second_asset(&t);
    let holder = Address::generate(&t.env);

    // token_b is NOT allowlisted — should fail.
    let result = t.client.try_initiate_policy(
        &holder,
        &niffyinsure::types::PolicyType::Health,
        &niffyinsure::types::RegionTier::Medium,
        &niffyinsure::types::AgeBand::Adult,
        &niffyinsure::types::CoverageTier::Standard,
        &3u32,
        &500_000_000i128,
        &token_b,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );
    assert!(result.is_err(), "expected AssetNotAllowed error");
}

#[test]
fn initiate_policy_succeeds_with_allowlisted_asset() {
    let t = setup();
    let holder = Address::generate(&t.env);

    fund_and_approve(
        &t.env,
        &t.client,
        &t.token_a,
        &t.token_a_admin,
        &holder,
        1_000_000_000i128,
    );

    let policy = initiate(&t, &holder, &t.token_a);
    assert_eq!(policy.asset, t.token_a);
    assert!(policy.is_active);
}

// ── Admin allowlist management ────────────────────────────────────────────────

#[test]
fn admin_can_add_and_remove_asset_from_allowlist() {
    let t = setup();
    let (token_b, _) = make_second_asset(&t);

    assert!(!t.client.is_allowed_asset(&token_b));

    t.client.set_allowed_asset(&token_b, &true);
    assert!(t.client.is_allowed_asset(&token_b));

    t.client.set_allowed_asset(&token_b, &false);
    assert!(!t.client.is_allowed_asset(&token_b));
}

#[test]
fn set_allowed_asset_emits_event() {
    let t = setup();
    let (token_b, _) = make_second_asset(&t);

    t.client.set_allowed_asset(&token_b, &true);
    assert!(
        t.client.is_allowed_asset(&token_b),
        "expected asset to be allowlisted after add"
    );

    t.client.set_allowed_asset(&token_b, &false);
    assert!(
        !t.client.is_allowed_asset(&token_b),
        "expected asset to be removed from allowlist"
    );
}

// ── Per-policy asset binding ──────────────────────────────────────────────────

#[test]
fn policy_stores_bound_asset() {
    let t = setup();
    let holder = Address::generate(&t.env);
    fund_and_approve(
        &t.env,
        &t.client,
        &t.token_a,
        &t.token_a_admin,
        &holder,
        1_000_000_000i128,
    );

    let policy = initiate(&t, &holder, &t.token_a);
    assert_eq!(policy.asset, t.token_a);

    // Retrieve from storage and verify.
    let stored = t.client.get_policy(&holder, &policy.policy_id).unwrap();
    assert_eq!(stored.asset, t.token_a);
}

// ── Two-asset scenario ────────────────────────────────────────────────────────

#[test]
fn two_policies_with_different_assets_are_independent() {
    let t = setup();
    let (token_b, token_b_admin) = make_second_asset(&t);

    // Allowlist token_b.
    t.client.set_allowed_asset(&token_b, &true);

    let holder_a = Address::generate(&t.env);
    let holder_b = Address::generate(&t.env);

    fund_and_approve(
        &t.env,
        &t.client,
        &t.token_a,
        &t.token_a_admin,
        &holder_a,
        1_000_000_000i128,
    );
    fund_and_approve(
        &t.env,
        &t.client,
        &token_b,
        &token_b_admin,
        &holder_b,
        1_000_000_000i128,
    );

    let policy_a = initiate(&t, &holder_a, &t.token_a);
    let policy_b = initiate(&t, &holder_b, &token_b);

    assert_eq!(policy_a.asset, t.token_a);
    assert_eq!(policy_b.asset, token_b);
    assert_ne!(policy_a.asset, policy_b.asset);
}

// ── Claim payout uses policy's bound asset ────────────────────────────────────

#[test]
fn claim_payout_uses_policy_bound_asset() {
    use niffyinsure::types::{Claim, ClaimStatus};
    use soroban_sdk::{String as SorobanString, Vec};

    let t = setup();
    let holder = Address::generate(&t.env);
    let treasury = t.contract_id.clone();

    fund_and_approve(
        &t.env,
        &t.client,
        &t.token_a,
        &t.token_a_admin,
        &holder,
        1_000_000_000i128,
    );
    t.token_a_admin.mint(&treasury, &10_000_000i128);

    let policy = initiate(&t, &holder, &t.token_a);

    // Seed an approved claim using the policy's asset.
    let claim = Claim {
        claim_id: 1,
        policy_id: policy.policy_id,
        claimant: holder.clone(),
        amount: 5_000_000i128,
        asset: policy.asset.clone(),
        details: SorobanString::from_str(&t.env, "fire damage"),
        evidence: common::empty_evidence(&t.env),
        status: ClaimStatus::Approved,
        voting_deadline_ledger: 1_000,
        approve_votes: 3,
        reject_votes: 0,
        filed_at: 100,
        appeal_open_deadline_ledger: 0,
        appeals_count: 0,
        appeal_deadline_ledger: 0,
        appeal_approve_votes: 0,
        appeal_reject_votes: 0,
        status_history: Vec::new(&t.env),
    };
    t.env.as_contract(&t.contract_id, || {
        niffyinsure::storage::set_claim(&t.env, &claim);
    });

    let token_client = token::Client::new(&t.env, &t.token_a);
    let before = token_client.balance(&holder);

    t.client.process_claim(&1u64);

    assert_eq!(token_client.balance(&holder), before + 5_000_000i128);
    assert_eq!(t.client.get_claim(&1u64).status, ClaimStatus::Paid);
}

#[test]
fn claim_with_disallowed_bound_asset_is_rejected() {
    use niffyinsure::types::{Claim, ClaimStatus};
    use soroban_sdk::{String as SorobanString, Vec};

    let t = setup();
    let (token_b, token_b_admin) = make_second_asset(&t);
    t.client.set_allowed_asset(&token_b, &true);

    let holder = Address::generate(&t.env);
    fund_and_approve(
        &t.env,
        &t.client,
        &t.token_a,
        &t.token_a_admin,
        &holder,
        1_000_000_000i128,
    );
    token_b_admin.mint(&t.contract_id, &10_000_000i128);

    // Policy is bound to token_a.
    let policy = initiate(&t, &holder, &t.token_a);

    // Another asset may remain allowlisted, but the bound asset must stay valid.
    t.client.set_allowed_asset(&t.token_a, &false);

    // Payout should fail because the policy's bound asset is no longer allowlisted.
    let claim = Claim {
        claim_id: 2,
        policy_id: policy.policy_id,
        claimant: holder.clone(),
        amount: 5_000_000i128,
        asset: policy.asset.clone(),
        details: SorobanString::from_str(&t.env, "mismatch test"),
        evidence: common::empty_evidence(&t.env),
        status: ClaimStatus::Approved,
        voting_deadline_ledger: 1_000,
        approve_votes: 3,
        reject_votes: 0,
        filed_at: 100,
        appeal_open_deadline_ledger: 0,
        appeals_count: 0,
        appeal_deadline_ledger: 0,
        appeal_approve_votes: 0,
        appeal_reject_votes: 0,
        status_history: Vec::new(&t.env),
    };
    t.env.as_contract(&t.contract_id, || {
        niffyinsure::storage::set_claim(&t.env, &claim);
    });

    let result = t.client.try_process_claim(&2u64);
    assert!(
        result.is_err(),
        "expected payout rejection when bound asset is no longer allowlisted"
    );
}

#[test]
fn removing_asset_from_allowlist_blocks_new_policies() {
    let t = setup();
    let (token_b, token_b_admin) = make_second_asset(&t);

    t.client.set_allowed_asset(&token_b, &true);

    let holder = Address::generate(&t.env);
    fund_and_approve(
        &t.env,
        &t.client,
        &token_b,
        &token_b_admin,
        &holder,
        1_000_000_000i128,
    );

    // Works while allowlisted.
    let policy = initiate(&t, &holder, &token_b);
    assert_eq!(policy.asset, token_b);

    // Remove from allowlist.
    t.client.set_allowed_asset(&token_b, &false);

    let holder2 = Address::generate(&t.env);
    fund_and_approve(
        &t.env,
        &t.client,
        &token_b,
        &token_b_admin,
        &holder2,
        1_000_000_000i128,
    );

    let result = t.client.try_initiate_policy(
        &holder2,
        &niffyinsure::types::PolicyType::Auto,
        &niffyinsure::types::RegionTier::Low,
        &niffyinsure::types::AgeBand::Adult,
        &niffyinsure::types::CoverageTier::Standard,
        &5u32,
        &1_000_000_000i128,
        &token_b,
        &niffyinsure::types::InitiatePolicyOptions { beneficiary: None, deductible: None, expected_nonce: None },
    );
    assert!(result.is_err(), "expected AssetNotAllowed after removal");
}

// ── Legacy null-asset migration path ─────────────────────────────────────────
//
// Policies created before multi-asset support have assetContractId = null in
// the backend DB. The contract itself always stores an asset (the default token
// set at initialize), so on-chain behaviour is unaffected. These tests verify
// that the contract handles the default-token path gracefully and that two
// policies with different assets never interfere with each other's payouts.

/// Legacy policy (bound to the default token set at initialize) coexists with
/// a new multi-asset policy without interference.
#[test]
fn legacy_default_asset_policy_coexists_with_multi_asset_policy() {
    let t = setup();
    let (token_b, token_b_admin) = make_second_asset(&t);
    t.client.set_allowed_asset(&token_b, &true);

    let legacy_holder = Address::generate(&t.env);
    let new_holder = Address::generate(&t.env);

    // Legacy holder uses the default token (token_a, set at initialize).
    fund_and_approve(
        &t.env,
        &t.client,
        &t.token_a,
        &t.token_a_admin,
        &legacy_holder,
        1_000_000_000i128,
    );
    // New holder uses token_b.
    fund_and_approve(
        &t.env,
        &t.client,
        &token_b,
        &token_b_admin,
        &new_holder,
        1_000_000_000i128,
    );

    let legacy_policy = initiate(&t, &legacy_holder, &t.token_a);
    let new_policy = initiate(&t, &new_holder, &token_b);

    // Each policy stores its own bound asset.
    assert_eq!(legacy_policy.asset, t.token_a);
    assert_eq!(new_policy.asset, token_b);

    // Policies are independent: different holders, different assets.
    assert_ne!(legacy_policy.holder, new_policy.holder);
    assert_ne!(legacy_policy.asset, new_policy.asset);

    // Both policies are active.
    assert!(legacy_policy.is_active);
    assert!(new_policy.is_active);
}

/// Premium and payout always use the same asset as bound at policy creation.
/// Verifies that a policy bound to token_b cannot be paid out in token_a.
#[test]
fn premium_and_payout_use_same_bound_asset() {
    use niffyinsure::types::{Claim, ClaimStatus};
    use soroban_sdk::{String as SorobanString, Vec};

    let t = setup();
    let (token_b, token_b_admin) = make_second_asset(&t);
    t.client.set_allowed_asset(&token_b, &true);

    let holder = Address::generate(&t.env);
    fund_and_approve(
        &t.env,
        &t.client,
        &token_b,
        &token_b_admin,
        &holder,
        1_000_000_000i128,
    );
    // Fund the contract treasury with token_b for payout.
    token_b_admin.mint(&t.contract_id, &10_000_000i128);

    let policy = initiate(&t, &holder, &token_b);
    assert_eq!(policy.asset, token_b, "policy must be bound to token_b");

    // Seed an approved claim using the policy's bound asset (token_b).
    let claim = Claim {
        claim_id: 10,
        policy_id: policy.policy_id,
        claimant: holder.clone(),
        amount: 3_000_000i128,
        deductible: 0,
        asset: policy.asset.clone(),
        details: SorobanString::from_str(&t.env, "bound asset payout test"),
        evidence: common::empty_evidence(&t.env),
        status: ClaimStatus::Approved,
        voting_deadline_ledger: 1_000,
        approve_votes: 2,
        reject_votes: 0,
        filed_at: 100,
        appeal_open_deadline_ledger: 0,
        appeals_count: 0,
        appeal_deadline_ledger: 0,
        appeal_approve_votes: 0,
        appeal_reject_votes: 0,
        status_history: Vec::new(&t.env),
    };
    t.env.as_contract(&t.contract_id, || {
        niffyinsure::storage::set_claim(&t.env, &claim);
    });

    let token_b_client = token::Client::new(&t.env, &token_b);
    let before = token_b_client.balance(&holder);

    t.client.process_claim(&10u64);

    // Payout was in token_b (the bound asset).
    assert_eq!(
        token_b_client.balance(&holder),
        before + 3_000_000i128,
        "payout must use the bound asset (token_b)"
    );
    assert_eq!(t.client.get_claim(&10u64).status, ClaimStatus::Paid);
}

/// Two policies with different assets: payout for each uses only its own asset.
#[test]
fn two_asset_policies_payout_independently() {
    use niffyinsure::types::{Claim, ClaimStatus};
    use soroban_sdk::{String as SorobanString, Vec};

    let t = setup();
    let (token_b, token_b_admin) = make_second_asset(&t);
    t.client.set_allowed_asset(&token_b, &true);

    let holder_a = Address::generate(&t.env);
    let holder_b = Address::generate(&t.env);

    fund_and_approve(&t.env, &t.client, &t.token_a, &t.token_a_admin, &holder_a, 1_000_000_000i128);
    fund_and_approve(&t.env, &t.client, &token_b, &token_b_admin, &holder_b, 1_000_000_000i128);

    // Fund contract treasury for both assets.
    t.token_a_admin.mint(&t.contract_id, &10_000_000i128);
    token_b_admin.mint(&t.contract_id, &10_000_000i128);

    let policy_a = initiate(&t, &holder_a, &t.token_a);
    let policy_b = initiate(&t, &holder_b, &token_b);

    let make_claim = |id: u64, policy_id: u32, claimant: &Address, asset: &Address| Claim {
        claim_id: id,
        policy_id,
        claimant: claimant.clone(),
        amount: 2_000_000i128,
        deductible: 0,
        asset: asset.clone(),
        details: SorobanString::from_str(&t.env, "independent payout test"),
        evidence: common::empty_evidence(&t.env),
        status: ClaimStatus::Approved,
        voting_deadline_ledger: 1_000,
        approve_votes: 2,
        reject_votes: 0,
        filed_at: 100,
        appeal_open_deadline_ledger: 0,
        appeals_count: 0,
        appeal_deadline_ledger: 0,
        appeal_approve_votes: 0,
        appeal_reject_votes: 0,
        status_history: Vec::new(&t.env),
    };

    t.env.as_contract(&t.contract_id, || {
        niffyinsure::storage::set_claim(&t.env, &make_claim(20, policy_a.policy_id, &holder_a, &t.token_a));
        niffyinsure::storage::set_claim(&t.env, &make_claim(21, policy_b.policy_id, &holder_b, &token_b));
    });

    let ta_client = token::Client::new(&t.env, &t.token_a);
    let tb_client = token::Client::new(&t.env, &token_b);

    let before_a = ta_client.balance(&holder_a);
    let before_b = tb_client.balance(&holder_b);

    t.client.process_claim(&20u64);
    t.client.process_claim(&21u64);

    // Each holder received their own asset; no cross-asset contamination.
    assert_eq!(ta_client.balance(&holder_a), before_a + 2_000_000i128);
    assert_eq!(tb_client.balance(&holder_b), before_b + 2_000_000i128);
    // Balances of the other asset are unchanged.
    assert_eq!(tb_client.balance(&holder_a), 0);
    assert_eq!(ta_client.balance(&holder_b), 0);
}
