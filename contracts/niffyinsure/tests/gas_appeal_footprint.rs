//! Appeal storage/ledger footprint vs. a normal claim vote cycle.
//!
//! `open_appeal` writes a fresh voter snapshot, a quorum snapshot, and reset
//! vote tallies on top of the claim record it already had to touch for a
//! normal vote — this benchmark quantifies that extra footprint.
//!
//! CPU instruction cost is used as the measurable proxy for ledger
//! read/write footprint (same convention as `gas_cross_contract.rs`) since
//! Soroban's `cost_estimate().budget()` in this SDK version does not expose a
//! standalone ledger-entry read/write counter; CPU cost scales with the
//! number and size of storage entries touched.
//!
//! Compares:
//!   - `normal_vote_cycle`: file_claim -> vote_on_claim x2 (majority reject,
//!     resolves without a separate finalize call).
//!   - `appeal_cycle`: the same normal_vote_cycle, plus open_appeal ->
//!     vote_on_appeal x2 -> finalize_appeal.
//!
//! The delta below isolates just the appeal-specific extra work (voter
//! snapshot + quorum snapshot + reset tallies + the appeal vote/finalize
//! calls), since both paths share the identical file+reject prefix.
//!
//! Run: cargo test --test gas_appeal_footprint --features testutils -- --nocapture

#![cfg(test)]

mod common;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

use niffyinsure::{types::VoteOption, NiffyInsureClient};

fn cpu(env: &Env) -> u64 {
    env.cost_estimate().budget().cpu_instruction_cost()
}

fn setup() -> (Env, NiffyInsureClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let contract_id = env.register(niffyinsure::NiffyInsure, ());
    let client = NiffyInsureClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    client.initialize(&admin, &token);
    (env, client, admin, token)
}

/// Files a claim and drives it to `Rejected` via majority vote. Returns the
/// claim id and the CPU cost of that shared file+reject prefix, so callers
/// can isolate the cost of what happens *after* rejection.
fn file_and_reject(
    env: &Env,
    client: &NiffyInsureClient,
    v1: &Address,
    v2: &Address,
    v3: &Address,
) -> u64 {
    client.test_seed_policy(v1, &1u32, &1_000_000i128, &500_000u32);
    client.test_seed_policy(v2, &1u32, &1_000_000i128, &500_000u32);
    client.test_seed_policy(v3, &1u32, &1_000_000i128, &500_000u32);

    let details = String::from_str(env, "brief claim description");
    let ev = common::empty_evidence(env);
    let cid = client.file_claim(v1, &1u32, &100_000i128, &details, &ev, &None);

    client.vote_on_claim(v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(v2, &cid, &VoteOption::Reject);
    cid
}

#[test]
fn bench_appeal_cycle_vs_normal_vote_cycle() {
    // ── Normal vote cycle: file + reject only, no appeal. ──
    let (env_normal, client_normal, _admin, _token) = setup();
    let v1 = Address::generate(&env_normal);
    let v2 = Address::generate(&env_normal);
    let v3 = Address::generate(&env_normal);

    let before = cpu(&env_normal);
    let _cid = file_and_reject(&env_normal, &client_normal, &v1, &v2, &v3);
    let normal_cpu = cpu(&env_normal) - before;

    // ── Appeal cycle: identical file + reject prefix, then a full appeal round. ──
    let (env_appeal, client_appeal, _admin2, _token2) = setup();
    let a1 = Address::generate(&env_appeal);
    let a2 = Address::generate(&env_appeal);
    let a3 = Address::generate(&env_appeal);

    let before = cpu(&env_appeal);
    let cid = file_and_reject(&env_appeal, &client_appeal, &a1, &a2, &a3);

    client_appeal.open_appeal(&a1, &cid);
    client_appeal.vote_on_appeal(&a1, &cid, &VoteOption::Approve);
    client_appeal.vote_on_appeal(&a2, &cid, &VoteOption::Approve);

    let appeal_deadline = client_appeal.get_claim(&cid).appeal_deadline_ledger;
    env_appeal
        .ledger()
        .with_mut(|l| l.sequence_number = appeal_deadline + 1);
    let _ = client_appeal.finalize_appeal(&cid);
    let appeal_cpu = cpu(&env_appeal) - before;

    let delta = appeal_cpu.saturating_sub(normal_cpu);
    println!("  normal_vote_cycle (file+reject)              {normal_cpu:>12} CPU");
    println!("  appeal_cycle (file+reject+appeal round)       {appeal_cpu:>12} CPU");
    println!("  appeal storage/ledger footprint delta         {delta:>12} CPU");

    assert!(
        appeal_cpu > normal_cpu,
        "appeal cycle ({appeal_cpu}) should cost more than the normal vote cycle alone ({normal_cpu}) \
         due to the extra voter snapshot, quorum snapshot, and reset tallies"
    );
}
