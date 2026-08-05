//! Rolling claim cap: cumulative **paid** amounts per policy per ledger window.

#![cfg(test)]

use niffyinsure::{
    types::{
        AgeBand, ClaimStatus, CoverageType, PolicyType, RegionTier, VoteOption,
        RATE_LIMIT_WINDOW_LEDGERS,
    },
    validate::Error,
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, vec, Address, Env, String,
};

const LEDGER: u32 = 500;
/// Must exceed `RATE_LIMIT_WINDOW_LEDGERS` so advancing past the claim rate limit
/// does not change the rolling-cap ledger bucket (same `window_start`).
const WINDOW: u32 = 50_000;
const CAP: i128 = 100_000;

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.sequence_number = LEDGER;
    });

    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer).address();

    client.initialize(&admin, &token);
    client.set_rolling_claim_window_ledgers(&WINDOW);
    client.set_rolling_claim_cap(&CAP);

    (env, client, admin, token)
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    token::StellarAssetClient::new(env, token).mint(to, &amount);
}

fn fund_and_bind(env: &Env, client: &NiffyInsureClient<'_>, token: &Address, holder: &Address) {
    mint(env, token, holder, 10_000_000_000i128);
    token::Client::new(env, token).approve(
        holder,
        &client.address,
        &10_000_000_000i128,
        &(env.ledger().sequence() + 50_000),
    );
}

fn seed_two_voters(client: &NiffyInsureClient<'_>, a: &Address, b: &Address) {
    client.test_seed_policy(a, &1u32, &1_000_000i128, &100_000u32);
    client.test_seed_policy(b, &1u32, &1_000_000i128, &100_000u32);
}

fn advance_past_claim_rate_limit(env: &Env) {
    env.ledger().with_mut(|l| {
        l.sequence_number = l
            .sequence_number
            .saturating_add(RATE_LIMIT_WINDOW_LEDGERS)
            .saturating_add(1);
    });
}

fn approve_and_pay(
    env: &Env,
    client: &NiffyInsureClient<'_>,
    voter_a: &Address,
    voter_b: &Address,
    claim_id: u64,
) {
    client.vote_on_claim(voter_a, &claim_id, &VoteOption::Approve);
    client.vote_on_claim(voter_b, &claim_id, &VoteOption::Approve);
    assert_eq!(client.get_claim(&claim_id).status, ClaimStatus::Approved);
    client.process_claim(&claim_id);
    assert_eq!(client.get_claim(&claim_id).status, ClaimStatus::Paid);
    let _ = env;
}

#[test]
fn single_claim_at_cap_succeeds() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    fund_and_bind(&env, &client, &token, &holder);
    seed_two_voters(&client, &v1, &v2);

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageType::Standard,
        &80,
        &500_000i128,
        &token,
        &niffyinsure::types::InitiatePolicyOptions::test_defaults(&env),
    );

    let details = String::from_str(&env, "at cap");
    let urls = vec![&env];
    let claim_id = client
        .try_file_claim(&holder, &policy.policy_id, &CAP, &details, &urls, &None)
        .unwrap()
        .unwrap();
    assert_eq!(claim_id, 1u64);
    assert_eq!(
        client.get_rolling_claim_remaining(&holder, &policy.policy_id),
        CAP
    );

    approve_and_pay(&env, &client, &v1, &v2, claim_id);
    assert_eq!(
        client.get_rolling_claim_remaining(&holder, &policy.policy_id),
        0
    );
}

#[test]
fn two_claims_summing_to_cap_succeed() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    fund_and_bind(&env, &client, &token, &holder);
    seed_two_voters(&client, &v1, &v2);

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageType::Standard,
        &80,
        &500_000i128,
        &token,
        &niffyinsure::types::InitiatePolicyOptions::test_defaults(&env),
    );

    let details = String::from_str(&env, "first");
    let urls = vec![&env];
    let c1 = client
        .try_file_claim(
            &holder,
            &policy.policy_id,
            &60_000i128,
            &details,
            &urls,
            &None,
        )
        .unwrap()
        .unwrap();
    approve_and_pay(&env, &client, &v1, &v2, c1);
    advance_past_claim_rate_limit(&env);

    let details2 = String::from_str(&env, "second");
    let c2 = client
        .try_file_claim(
            &holder,
            &policy.policy_id,
            &40_000i128,
            &details2,
            &urls,
            &None,
        )
        .unwrap()
        .unwrap();
    approve_and_pay(&env, &client, &v1, &v2, c2);

    assert_eq!(
        client.get_rolling_claim_remaining(&holder, &policy.policy_id),
        0
    );
}

#[test]
fn file_claim_over_cap_fails() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    fund_and_bind(&env, &client, &token, &holder);
    seed_two_voters(&client, &v1, &v2);

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageType::Standard,
        &80,
        &500_000i128,
        &token,
        &niffyinsure::types::InitiatePolicyOptions::test_defaults(&env),
    );

    let details = String::from_str(&env, "too big");
    let urls = vec![&env];
    match client.try_file_claim(
        &holder,
        &policy.policy_id,
        &(CAP + 1),
        &details,
        &urls,
        &None,
    ) {
        Ok(Err(e)) => assert_eq!(e, Error::RollingClaimCapExceeded.into()),
        Ok(Ok(id)) => panic!("expected cap error, got success claim_id={id}"),
        Err(e) => {
            let s = format!("{e:?}");
            assert!(
                s.contains("RollingClaimCapExceeded"),
                "expected RollingClaimCapExceeded, got {s}"
            );
        }
    }
}

#[test]
fn cap_lowered_after_file_does_not_block_payout() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    fund_and_bind(&env, &client, &token, &holder);
    seed_two_voters(&client, &v1, &v2);

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageType::Standard,
        &80,
        &500_000i128,
        &token,
        &niffyinsure::types::InitiatePolicyOptions::test_defaults(&env),
    );

    let details = String::from_str(&env, "in flight");
    let urls = vec![&env];
    let claim_id = client
        .try_file_claim(
            &holder,
            &policy.policy_id,
            &80_000i128,
            &details,
            &urls,
            &None,
        )
        .unwrap()
        .unwrap();

    // Stricter cap applies to new filings only; this approved claim must still pay.
    let _ = client.try_set_rolling_claim_cap(&50_000i128).unwrap();

    client.vote_on_claim(&v1, &claim_id, &VoteOption::Approve);
    client.vote_on_claim(&v2, &claim_id, &VoteOption::Approve);
    client.process_claim(&claim_id);

    assert_eq!(client.get_claim(&claim_id).status, ClaimStatus::Paid);
    assert_eq!(
        client.get_rolling_claim_remaining(&holder, &policy.policy_id),
        0
    );
}

#[test]
fn window_rollover_resets_cumulative() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    fund_and_bind(&env, &client, &token, &holder);
    seed_two_voters(&client, &v1, &v2);

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageType::Standard,
        &80,
        &500_000i128,
        &token,
        &niffyinsure::types::InitiatePolicyOptions::test_defaults(&env),
    );

    let details = String::from_str(&env, "w1");
    let urls = vec![&env];
    let c1 = client
        .try_file_claim(&holder, &policy.policy_id, &CAP, &details, &urls, &None)
        .unwrap()
        .unwrap();
    approve_and_pay(&env, &client, &v1, &v2, c1);

    // Next rolling-cap bucket and past per-holder claim rate limit.
    advance_past_claim_rate_limit(&env);
    env.ledger().with_mut(|l| {
        let w = WINDOW;
        let seq = l.sequence_number;
        l.sequence_number = seq.saturating_div(w).saturating_add(1).saturating_mul(w);
    });

    let details2 = String::from_str(&env, "w2");
    let c2 = client
        .try_file_claim(&holder, &policy.policy_id, &CAP, &details2, &urls, &None)
        .unwrap()
        .unwrap();
    approve_and_pay(&env, &client, &v1, &v2, c2);
    assert_eq!(client.get_claim(&c2).status, ClaimStatus::Paid);
}

/// Issue #1152: rolling cap RESETS across a policy renewal boundary.
///
/// A claim paid just before renewal fills the cap; after renewal (same ledger
/// bucket) a same-sized claim must succeed because cumulative_paid was cleared.
#[test]
fn rolling_cap_resets_across_policy_renewal() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    fund_and_bind(&env, &client, &token, &holder);
    seed_two_voters(&client, &v1, &v2);

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageType::Standard,
        &80,
        &500_000i128,
        &token,
        &niffyinsure::types::InitiatePolicyOptions::test_defaults(&env),
    );

    let details = String::from_str(&env, "pre-renewal");
    let urls = vec![&env];
    let c1 = client
        .try_file_claim(&holder, &policy.policy_id, &CAP, &details, &urls, &None)
        .unwrap()
        .unwrap();
    approve_and_pay(&env, &client, &v1, &v2, c1);
    assert_eq!(
        client.get_rolling_claim_remaining(&holder, &policy.policy_id),
        0
    );

    // Stay inside the same ledger window bucket, past claim rate limit, then renew.
    advance_past_claim_rate_limit(&env);
    assert_eq!(
        env.ledger().sequence() / WINDOW,
        LEDGER / WINDOW,
        "renewal must stay in the same ledger window so the reset is attributable to renewal"
    );
    client.test_renew_policy(&holder, &policy.policy_id);
    assert_eq!(
        client.get_rolling_claim_remaining(&holder, &policy.policy_id),
        CAP,
        "cap headroom must be restored after renewal"
    );

    let details2 = String::from_str(&env, "post-renewal");
    let c2 = client
        .try_file_claim(&holder, &policy.policy_id, &CAP, &details2, &urls, &None)
        .unwrap()
        .unwrap();
    approve_and_pay(&env, &client, &v1, &v2, c2);
    assert_eq!(client.get_claim(&c2).status, ClaimStatus::Paid);
}

/// Issue #1153: claims at ledger immediately before / exactly at / after the
/// window boundary must match the documented half-open window definition.
#[test]
fn rolling_cap_window_boundary_ledgers() {
    let (env, client, _admin, token) = setup();
    let holder = Address::generate(&env);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    fund_and_bind(&env, &client, &token, &holder);
    seed_two_voters(&client, &v1, &v2);

    // Boundary = first ledger of bucket 1. Place the pre-boundary filing far enough
    // back that one rate-limit advance lands exactly on the boundary.
    let boundary = WINDOW;
    let before = boundary.saturating_sub(1);
    // pre_file + RATE_LIMIT_WINDOW_LEDGERS + 1 == boundary
    let pre_file = boundary
        .saturating_sub(RATE_LIMIT_WINDOW_LEDGERS)
        .saturating_sub(1);
    env.ledger().with_mut(|l| {
        l.sequence_number = pre_file;
    });

    let policy = client.initiate_policy(
        &holder,
        &PolicyType::Auto,
        &RegionTier::Medium,
        &AgeBand::Adult,
        &CoverageType::Standard,
        &80,
        &500_000i128,
        &token,
        &niffyinsure::types::InitiatePolicyOptions::test_defaults(&env),
    );
    let urls = vec![&env];

    // 1) File in the ledger window BEFORE the boundary (bucket 0).
    let details_before = String::from_str(&env, "before-boundary");
    let c_before = client
        .try_file_claim(
            &holder,
            &policy.policy_id,
            &60_000i128,
            &details_before,
            &urls,
            &None,
        )
        .unwrap()
        .unwrap();
    approve_and_pay(&env, &client, &v1, &v2, c_before);

    // Confirm the ledger immediately before the boundary is still bucket 0.
    env.ledger().with_mut(|l| {
        l.sequence_number = before;
    });
    let _ = client.get_rolling_claim_remaining(&holder, &policy.policy_id);
    let state_before = client
        .get_rolling_claim_state(&holder, &policy.policy_id)
        .unwrap();
    assert_eq!(
        state_before.window_start, 0,
        "ledger immediately before boundary stays in the prior window"
    );
    assert_eq!(state_before.cumulative_paid, 60_000);

    // 2) Exactly AT the boundary → next bucket (prior cumulative must not carry).
    env.ledger().with_mut(|l| {
        l.sequence_number = pre_file;
    });
    advance_past_claim_rate_limit(&env);
    assert_eq!(
        env.ledger().sequence(),
        boundary,
        "rate-limit advance from pre_file must land on the exact boundary ledger"
    );
    let details_at = String::from_str(&env, "at-boundary");
    let c_at = client
        .try_file_claim(&holder, &policy.policy_id, &CAP, &details_at, &urls, &None)
        .unwrap()
        .unwrap();
    approve_and_pay(&env, &client, &v1, &v2, c_at);
    let state_at = client
        .get_rolling_claim_state(&holder, &policy.policy_id)
        .unwrap();
    assert_eq!(
        state_at.window_start, boundary,
        "exact boundary ledger must open the new window"
    );
    assert_eq!(
        state_at.cumulative_paid, CAP,
        "new window must start fresh (prior bucket paid amount excluded)"
    );

    // 3) Immediately AFTER the boundary → same new bucket; headroom exhausted.
    advance_past_claim_rate_limit(&env);
    env.ledger().with_mut(|l| {
        // Ensure we are strictly after the boundary but still in bucket 1.
        if l.sequence_number <= boundary {
            l.sequence_number = boundary.saturating_add(1);
        }
    });
    assert!(env.ledger().sequence() > boundary);
    assert_eq!(
        env.ledger().sequence() / WINDOW,
        boundary / WINDOW,
        "post-boundary ledger must remain in the new window bucket"
    );
    assert_eq!(
        client.get_rolling_claim_remaining(&holder, &policy.policy_id),
        0
    );
    let details_after = String::from_str(&env, "after-boundary");
    match client.try_file_claim(
        &holder,
        &policy.policy_id,
        &1i128,
        &details_after,
        &urls,
        &None,
    ) {
        Ok(Err(e)) => assert_eq!(e, Error::RollingClaimCapExceeded.into()),
        Ok(Ok(id)) => panic!("expected cap error after boundary, got claim_id={id}"),
        Err(e) => {
            let s = format!("{e:?}");
            assert!(
                s.contains("RollingClaimCapExceeded"),
                "expected RollingClaimCapExceeded, got {s}"
            );
        }
    }
}
