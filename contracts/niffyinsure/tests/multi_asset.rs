//! Multi-asset configuration tests.
//!
//! Covers:
//! - Allowlist enforcement: premiums and payouts rejected for non-allowlisted assets.
//! - Per-policy asset binding: policy stores the asset used at initiation.
//! - Admin allowlist management with event emission.
//! - Two-asset scenario: two policies with different assets, independent payouts.
//! - Claim payout uses the policy's bound asset, not an arbitrary one.

#![cfg(test)]

use niffyinsure::NiffyInsureClient;
use soroban_sdk::{
    testutils::Address as _,
    token, Address, Env,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

struct TestEnv<'a> {
    env: Env,
    client: NiffyInsureClient<'a>,
    contract_id: Address,
    admin: Address,
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
        admin,
        token_a,
        token_a_admin,
    }
}

fn make_second_asset(t: &TestEnv) -> (Address, token::StellarAssetClient) {
    let issuer = Address::generate(&t.env);
    let addr = t
        .env
        .register_stellar_asset_contract_v2(issuer)
        .address();
    let admin_client = token::StellarAssetClient::new(&t.env, &addr);
    (addr, admin_client)
}

fn initiate(
    t: &TestEnv,
    holder: &Address,
    asset: &Address,
) -> niffyinsure::types::Policy {
    use niffyinsure::types::{PolicyType, RegionTier};
    t.client.initiate_policy(
        holder,
        &PolicyType::Auto,
        &RegionTier::Low,
        &1_000_000_000i128,
        &30u32,
        &5u32,
        asset,
    )
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
        &500_000_000i128,
        &25u32,
        &3u32,
        &token_b,
    );
    assert!(result.is_err(), "expected AssetNotAllowed error");
}

#[test]
fn initiate_policy_succeeds_with_allowlisted_asset() {
    let t = setup();
    let holder = Address::generate(&t.env);

    // Mint enough for premium payment.
    let token_client = token::Client::new(&t.env, &t.token_a);
    t.token_a_admin.mint(&holder, &1_000_000_000i128);

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

    let before = t.env.events().all().len();
    t.client.set_allowed_asset(&token_b, &true);
    assert!(
        t.env.events().all().len() > before,
        "expected AssetAdded event"
    );

    let before2 = t.env.events().all().len();
    t.client.set_allowed_asset(&token_b, &false);
    assert!(
        t.env.events().all().len() > before2,
        "expected AssetRemoved event"
    );
}

// ── Per-policy asset binding ──────────────────────────────────────────────────

#[test]
fn policy_stores_bound_asset() {
    let t = setup();
    let holder = Address::generate(&t.env);
    t.token_a_admin.mint(&holder, &1_000_000_000i128);

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

    t.token_a_admin.mint(&holder_a, &1_000_000_000i128);
    token_b_admin.mint(&holder_b, &1_000_000_000i128);

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

    t.token_a_admin.mint(&holder, &1_000_000_000i128);
    t.token_a_admin.mint(&treasury, &10_000_000i128);

    let policy = initiate(&t, &holder, &t.token_a);

    // Seed an approved claim using the policy's asset.
    let claim = Claim {
        claim_id: 1,
        policy_id: policy.policy_id,
        claimant: holder.clone(),
        amount: 5_000_000i128,
        asset: t.token_a.clone(),
        details: SorobanString::from_str(&t.env, "fire damage"),
        image_urls: Vec::new(&t.env),
        status: ClaimStatus::Approved,
        approve_votes: 3,
        reject_votes: 0,
        paid_at: None,
    };
    niffyinsure::storage::set_claim(&t.env, &claim);

    let token_client = token::Client::new(&t.env, &t.token_a);
    let before = token_client.balance(&holder);

    t.client.process_claim(&1u64);

    assert_eq!(token_client.balance(&holder), before + 5_000_000i128);
    assert_eq!(t.client.get_claim(&1u64).status, ClaimStatus::Paid);
}

#[test]
fn claim_with_wrong_asset_is_rejected() {
    use niffyinsure::types::{Claim, ClaimStatus};
    use soroban_sdk::{String as SorobanString, Vec};

    let t = setup();
    let (token_b, token_b_admin) = make_second_asset(&t);
    t.client.set_allowed_asset(&token_b, &true);

    let holder = Address::generate(&t.env);
    t.token_a_admin.mint(&holder, &1_000_000_000i128);
    token_b_admin.mint(&t.contract_id, &10_000_000i128);

    // Policy is bound to token_a.
    let policy = initiate(&t, &holder, &t.token_a);

    // Claim references token_b — should be rejected even though token_b is allowlisted.
    let claim = Claim {
        claim_id: 2,
        policy_id: policy.policy_id,
        claimant: holder.clone(),
        amount: 5_000_000i128,
        asset: token_b.clone(),
        details: SorobanString::from_str(&t.env, "mismatch test"),
        image_urls: Vec::new(&t.env),
        status: ClaimStatus::Approved,
        approve_votes: 3,
        reject_votes: 0,
        paid_at: None,
    };
    niffyinsure::storage::set_claim(&t.env, &claim);

    let result = t.client.try_process_claim(&2u64);
    assert!(result.is_err(), "expected InvalidAsset error for asset mismatch");
}

#[test]
fn removing_asset_from_allowlist_blocks_new_policies() {
    let t = setup();
    let (token_b, token_b_admin) = make_second_asset(&t);

    t.client.set_allowed_asset(&token_b, &true);

    let holder = Address::generate(&t.env);
    token_b_admin.mint(&holder, &1_000_000_000i128);

    // Works while allowlisted.
    let policy = initiate(&t, &holder, &token_b);
    assert_eq!(policy.asset, token_b);

    // Remove from allowlist.
    t.client.set_allowed_asset(&token_b, &false);

    let holder2 = Address::generate(&t.env);
    token_b_admin.mint(&holder2, &1_000_000_000i128);

    let result = t.client.try_initiate_policy(
        &holder2,
        &niffyinsure::types::PolicyType::Auto,
        &niffyinsure::types::RegionTier::Low,
        &1_000_000_000i128,
        &30u32,
        &5u32,
        &token_b,
    );
    assert!(result.is_err(), "expected AssetNotAllowed after removal");
}
