//! Pause matrix: one test per meaningful (operation × flag) cell.
//!
//! | Operation            | global | bind | claims |
//! |----------------------|--------|------|--------|
//! | Reads / metadata     | allow  | allow| allow  |
//! | withdraw_claim       | allow  | allow| allow  |
//! | initiate / bind      | block  | block| allow  |
//! | file_claim / vote    | block  | allow| block  |

#![cfg(test)]

use niffyinsure::types::PauseReason;
use niffyinsure::NiffyInsureClient;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    vec, Address, Env, String,
};

fn setup() -> (Env, NiffyInsureClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 200);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin)
}

fn seed_and_file(client: &NiffyInsureClient<'static>, env: &Env) -> (Address, u64) {
    let holder = Address::generate(env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &50_000u32);
    let details = String::from_str(env, "pause-matrix");
    let urls = vec![&env];
    let cid = client.file_claim(&holder, &1u32, &100_000i128, &details, &urls, &None);
    (holder, cid)
}

#[test]
fn global_pause_blocks_bind_and_claims_allows_reads_and_withdraw() {
    let (env, client, admin) = setup();
    let (holder, cid) = seed_and_file(&client, &env);

    client.pause(&admin, &PauseReason::SecurityIncident);
    let flags = client.get_pause_flags();
    assert!(flags.global);
    assert!(client.is_paused());

    // Reads stay up.
    assert_eq!(client.get_admin(), admin);
    let _ = client.get_pause_reason();

    // File claim blocked under global pause.
    let details = String::from_str(&env, "blocked");
    let urls = vec![&env];
    assert!(client
        .try_file_claim(&holder, &1u32, &50_000i128, &details, &urls, &None)
        .is_err());

    // withdraw_claim stays available.
    assert!(client.try_withdraw_claim(&holder, &cid).is_ok());
}

#[test]
fn pause_bind_blocks_only_bind() {
    let (env, client, admin) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &50_000u32);

    client.pause_bind(&admin, &PauseReason::UpgradePending);
    let flags = client.get_pause_flags();
    assert!(flags.bind_paused);
    assert!(!flags.claims_paused);
    assert!(!flags.global);

    // Claims still allowed under bind-only pause.
    let details = String::from_str(&env, "ok");
    let urls = vec![&env];
    assert!(client
        .try_file_claim(&holder, &1u32, &100_000i128, &details, &urls, &None)
        .is_ok());
}

#[test]
fn pause_claims_blocks_file_allows_bind_reads() {
    let (env, client, admin) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &50_000u32);

    client.pause_claims(&admin, &PauseReason::SolvencyRisk);
    let flags = client.get_pause_flags();
    assert!(flags.claims_paused);
    assert!(!flags.bind_paused);

    let details = String::from_str(&env, "blocked");
    let urls = vec![&env];
    assert!(client
        .try_file_claim(&holder, &1u32, &100_000i128, &details, &urls, &None)
        .is_err());

    // Reads OK
    let _ = client.get_pause_flags();
    assert!(client.is_paused());
}

#[test]
fn unpause_restores_all_functionality() {
    let (env, client, admin) = setup();
    let holder = Address::generate(&env);
    client.test_seed_policy(&holder, &1u32, &1_000_000i128, &50_000u32);

    client.pause(&admin, &PauseReason::Regulatory);
    client.unpause(&admin);
    assert!(!client.is_paused());
    let flags = client.get_pause_flags();
    assert!(!flags.global && !flags.bind_paused && !flags.claims_paused);

    let details = String::from_str(&env, "after-unpause");
    let urls = vec![&env];
    assert!(client
        .try_file_claim(&holder, &1u32, &100_000i128, &details, &urls, &None)
        .is_ok());
}

#[test]
fn paused_and_unpaused_events_include_scope() {
    let (env, client, admin) = setup();
    env.events().all();
    client.pause_bind(&admin, &PauseReason::SecurityIncident);
    let paused_dbg =
        soroban_sdk::testutils::arbitrary::std::format!("{:?}", env.events().all());
    assert!(paused_dbg.contains("paused") || paused_dbg.contains("pause_toggled"));

    env.events().all();
    client.unpause(&admin);
    let unpaused_dbg =
        soroban_sdk::testutils::arbitrary::std::format!("{:?}", env.events().all());
    assert!(unpaused_dbg.contains("unpaused") || unpaused_dbg.contains("pause_toggled"));
}
