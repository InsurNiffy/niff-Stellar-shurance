//! Security audit negative tests.
//!
//! Maps directly to the threat matrix in SECURITY.md.
//! Each test is labelled with the threat ID it covers.
//!
//! Threat IDs:
//!   AUTH-01  Admin entrypoints reject non-admin callers
//!   AUTH-02  Two-step rotation cannot be hijacked by unrelated signers
//!   AUTH-03  initialize cannot be called twice
//!   AUTH-04  accept_admin without a proposal reverts
//!   ARITH-01 Counter overflow panics rather than wrapping
//!   TOKEN-01 Drain rejects zero / negative amounts
//!   TOKEN-02 Non-admin cannot drain
//!   EVENT-01 Every admin mutation emits a structured event

#![cfg(test)]

use niffyinsure::{AdminError, NiffyInsureClient};
use soroban_sdk::{
    testutils::{Address as _, Events, MockAuth, MockAuthInvoke},
    vec, Address, Env,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let cid = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

/// Build a fresh env where only `signer` is mocked for `fn_name` on `cid`.
fn env_with_single_auth<'a>(
    env: &'a Env,
    cid: &Address,
    signer: &Address,
    fn_name: &str,
    args: soroban_sdk::Vec<soroban_sdk::Val>,
) {
    env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &MockAuthInvoke {
            contract: cid,
            fn_name,
            args,
            sub_invokes: &[],
        },
    }]);
}

// ── AUTH-03: double-initialize ────────────────────────────────────────────────

#[test]
fn auth03_initialize_twice_reverts() {
    let (env, client, _, _) = setup();
    let a2 = Address::generate(&env);
    let t2 = Address::generate(&env);
    assert!(client.try_initialize(&a2, &t2).is_err());
}

// ── AUTH-01: non-admin callers revert on every privileged entrypoint ──────────

fn make_non_admin_env() -> (Env, NiffyInsureClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let cid = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &cid);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    let rando = Address::generate(&env);
    (env, client, admin, token, rando)
}

#[test]
fn auth01_non_admin_cannot_propose_admin() {
    let (env, client, _, _, rando) = make_non_admin_env();
    let new_admin = Address::generate(&env);
    env_with_single_auth(
        &env,
        client.address(),
        &rando,
        "propose_admin",
        soroban_sdk::vec![
            &env,
            soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&new_admin, &env)
        ],
    );
    assert!(client.try_propose_admin(&new_admin).is_err());
}

#[test]
fn auth01_non_admin_cannot_cancel_admin() {
    let (env, client, _, _, rando) = make_non_admin_env();
    let new_admin = Address::generate(&env);
    // First propose with real admin
    env.mock_all_auths();
    client.propose_admin(&new_admin);
    // Now try cancel as rando
    env_with_single_auth(
        &env,
        client.address(),
        &rando,
        "cancel_admin",
        soroban_sdk::vec![&env],
    );
    assert!(client.try_cancel_admin().is_err());
}

#[test]
fn auth01_non_admin_cannot_set_token() {
    let (env, client, _, _, rando) = make_non_admin_env();
    let new_token = Address::generate(&env);
    env_with_single_auth(
        &env,
        client.address(),
        &rando,
        "set_token",
        soroban_sdk::vec![
            &env,
            soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&new_token, &env)
        ],
    );
    assert!(client.try_set_token(&new_token).is_err());
}

#[test]
fn auth01_non_admin_cannot_pause() {
    let (env, client, _, _, rando) = make_non_admin_env();
    env_with_single_auth(&env, client.address(), &rando, "pause", vec![&env]);
    assert!(client.try_pause().is_err());
}

#[test]
fn auth01_non_admin_cannot_unpause() {
    let (env, client, _, _, rando) = make_non_admin_env();
    // Pause first as real admin
    env.mock_all_auths();
    client.pause();
    // Try unpause as rando
    env_with_single_auth(&env, client.address(), &rando, "unpause", vec![&env]);
    assert!(client.try_unpause().is_err());
}

#[test]
fn auth01_non_admin_cannot_drain() {
    let (env, client, _, _, rando) = make_non_admin_env();
    let recipient = Address::generate(&env);
    env_with_single_auth(
        &env,
        client.address(),
        &rando,
        "drain",
        soroban_sdk::vec![
            &env,
            soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&recipient, &env),
            soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&1_000_000i128, &env)
        ],
    );
    assert!(client.try_drain(&recipient, &1_000_000i128).is_err());
}

// ── AUTH-02: rotation hijack prevention ───────────────────────────────────────

#[test]
fn auth02_unrelated_signer_cannot_accept_pending_admin() {
    // propose sets pending = new_admin; a third party calling accept_admin
    // must fail because accept_admin calls pending.require_auth() against
    // the *stored* address, not any parameter.
    let (env, client, _, _) = setup();
    let new_admin = Address::generate(&env);
    let hijacker = Address::generate(&env);

    client.propose_admin(&new_admin);

    env_with_single_auth(&env, client.address(), &hijacker, "accept_admin", vec![&env]);
    assert!(client.try_accept_admin().is_err());
}

#[test]
fn auth02_spoofed_address_cannot_satisfy_admin_auth() {
    // Passing a different address as a parameter to propose_admin while only
    // having auth for that parameter address (not the stored admin) must fail.
    let (env, client, _, _) = setup();
    let attacker = Address::generate(&env);
    let victim = Address::generate(&env);

    // Attacker mocks auth for themselves, not for the stored admin
    env_with_single_auth(
        &env,
        client.address(),
        &attacker,
        "propose_admin",
        soroban_sdk::vec![
            &env,
            soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&victim, &env)
        ],
    );
    assert!(client.try_propose_admin(&victim).is_err());
}

// ── AUTH-04: accept without proposal ─────────────────────────────────────────

#[test]
fn auth04_accept_admin_without_proposal_reverts() {
    let (_env, client, _, _) = setup();
    assert!(client.try_accept_admin().is_err());
}

#[test]
fn auth04_cancel_admin_without_proposal_reverts() {
    let (_env, client, _, _) = setup();
    assert!(client.try_cancel_admin().is_err());
}

// ── TOKEN-01: drain amount validation ────────────────────────────────────────

#[test]
fn token01_drain_zero_amount_reverts() {
    let (env, client, _, _) = setup();
    let recipient = Address::generate(&env);
    assert!(client.try_drain(&recipient, &0i128).is_err());
}

#[test]
fn token01_drain_negative_amount_reverts() {
    let (env, client, _, _) = setup();
    let recipient = Address::generate(&env);
    assert!(client.try_drain(&recipient, &(-1i128)).is_err());
}

// ── TOKEN-02: non-admin drain ─────────────────────────────────────────────────

#[test]
fn token02_non_admin_drain_reverts() {
    let (env, client, _, _, rando) = make_non_admin_env();
    let recipient = Address::generate(&env);
    env_with_single_auth(
        &env,
        client.address(),
        &rando,
        "drain",
        soroban_sdk::vec![
            &env,
            soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&recipient, &env),
            soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&500_000i128, &env)
        ],
    );
    assert!(client.try_drain(&recipient, &500_000i128).is_err());
}

// ── EVENT-01: every admin mutation emits a structured event ──────────────────

#[test]
fn event01_propose_admin_emits_event() {
    let (env, client, _, _) = setup();
    let new_admin = Address::generate(&env);
    client.propose_admin(&new_admin);
    assert!(!env.events().all().is_empty());
}

#[test]
fn event01_accept_admin_emits_event() {
    let (env, client, _, _) = setup();
    let new_admin = Address::generate(&env);
    client.propose_admin(&new_admin);
    let before = env.events().all().len();
    client.accept_admin();
    assert!(env.events().all().len() > before);
}

#[test]
fn event01_cancel_admin_emits_event() {
    let (env, client, _, _) = setup();
    let new_admin = Address::generate(&env);
    client.propose_admin(&new_admin);
    let before = env.events().all().len();
    client.cancel_admin();
    assert!(env.events().all().len() > before);
}

#[test]
fn event01_set_token_emits_event() {
    let (env, client, _, _) = setup();
    let new_token = Address::generate(&env);
    client.set_token(&new_token);
    assert!(!env.events().all().is_empty());
}

#[test]
fn event01_pause_emits_event() {
    let (env, client, _, _) = setup();
    client.pause();
    assert!(!env.events().all().is_empty());
}

#[test]
fn event01_unpause_emits_event() {
    let (env, client, _, _) = setup();
    client.pause();
    let before = env.events().all().len();
    client.unpause();
    assert!(env.events().all().len() > before);
}

// ── Two-step rotation happy path ──────────────────────────────────────────────

#[test]
fn rotation_full_happy_path() {
    let (env, client, _, _) = setup();
    let new_admin = Address::generate(&env);
    client.propose_admin(&new_admin);
    client.accept_admin();
    // New admin can now propose again (mock_all_auths covers new admin)
    let next = Address::generate(&env);
    client.propose_admin(&next);
}

#[test]
fn rotation_cancel_then_repropose() {
    let (env, client, _, _) = setup();
    let bad = Address::generate(&env);
    let good = Address::generate(&env);
    client.propose_admin(&bad);
    client.cancel_admin();
    // After cancel, accept must fail
    assert!(client.try_accept_admin().is_err());
    // Can re-propose with correct address
    client.propose_admin(&good);
    client.accept_admin();
}
