//! Appeal mechanism coverage: pre-deadline finalize behavior, AppealOpened
//! event/storage parity, and permissionless finalize_appeal caller coverage.

#![cfg(test)]

mod common;

use niffyinsure::{
    types::{ClaimStatus, VoteOption},
    validate::Error,
    NiffyInsureClient,
};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Env, String,
};

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

fn seed(client: &NiffyInsureClient, holder: &Address, coverage: i128, end_ledger: u32) {
    client.test_seed_policy(holder, &1u32, &coverage, &end_ledger);
}

fn file(client: &NiffyInsureClient, holder: &Address, amount: i128, env: &Env) -> u64 {
    let details = String::from_str(env, "brief claim description");
    let ev = common::empty_evidence(env);
    client.file_claim(holder, &1u32, &amount, &details, &ev, &None)
}

/// Three-voter setup, claim filed by v1, majority-rejected, appeal opened by v1.
/// Returns the claim id with status == UnderAppeal.
fn rejected_and_appealed() -> (Env, NiffyInsureClient<'static>, Address, Address, Address, u64) {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);

    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &niffyinsure::types::VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &niffyinsure::types::VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

    client.open_appeal(&v1, &cid);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::UnderAppeal);

    (env, client, v1, v2, v3, cid)
}

/// Issue: finalize_appeal must not resolve before its deadline, even with
/// quorum unmet — it errors with VotingWindowStillOpen rather than no-op'ing
/// or resolving early.
#[test]
fn finalize_appeal_before_deadline_errors_with_quorum_unmet() {
    let (_env, client, _v1, _v2, _v3, cid) = rejected_and_appealed();

    // No appeal votes cast (quorum is unmet) and the appeal deadline has not
    // yet passed — finalize must reject the call, not silently no-op.
    let result = client.try_finalize_appeal(&cid);
    assert!(
        result.is_err(),
        "finalize_appeal must error before the appeal deadline, regardless of quorum state"
    );

    // Status must remain UnderAppeal — no premature resolution.
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::UnderAppeal);
}

/// Issue: AppealOpened must carry exactly the values persisted via
/// `set_appeal_claim_quorum_bps` and `claim.appeal_deadline_ledger` — no drift
/// between the emitted event and storage.
#[test]
fn appeal_opened_event_matches_persisted_state() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);

    let cid = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid, &niffyinsure::types::VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &niffyinsure::types::VoteOption::Reject);

    env.events().all(); // drain pre-appeal events

    client.open_appeal(&v1, &cid);

    // Storage is the source of truth: what finalize_appeal will actually use.
    let persisted_claim = client.get_claim(&cid);
    let persisted_quorum_bps = env.as_contract(&client.address, || {
        niffyinsure::storage::get_appeal_claim_quorum_bps(&env, cid)
    });

    let all_events = env.events().all();
    let events_debug = soroban_sdk::testutils::arbitrary::std::format!("{:?}", all_events);

    let deadline_str = soroban_sdk::testutils::arbitrary::std::format!(
        "{}",
        persisted_claim.appeal_deadline_ledger
    );
    let quorum_str = soroban_sdk::testutils::arbitrary::std::format!("{}", persisted_quorum_bps);

    assert!(
        events_debug.contains(&deadline_str),
        "AppealOpened event must carry the persisted appeal_deadline_ledger ({}); events: {}",
        persisted_claim.appeal_deadline_ledger,
        events_debug
    );
    assert!(
        events_debug.contains(&quorum_str),
        "AppealOpened event must carry the persisted quorum_bps ({}); events: {}",
        persisted_quorum_bps,
        events_debug
    );
}

/// Issue: finalize_appeal (claim.rs) is a permissionless, deadline-based keeper
/// call — it takes no caller/Address parameter at all, so any account can
/// invoke it once the appeal deadline has passed. This test drives the call
/// after the deadline (with no appeal votes cast, so quorum is unmet) and
/// confirms it succeeds and resolves to the documented no-quorum outcome
/// (AppealRejected), independent of who submits the transaction.
#[test]
fn finalize_appeal_succeeds_for_arbitrary_caller_after_deadline() {
    let (env, client, _v1, _v2, _v3, cid) = rejected_and_appealed();

    // A random, non-voter, non-admin address — included to make explicit that
    // finalize_appeal has no caller/auth requirement to satisfy.
    let arbitrary_caller = Address::generate(&env);
    let _ = &arbitrary_caller;

    // Advance past this claim's persisted appeal voting deadline.
    let appeal_deadline_ledger = client.get_claim(&cid).appeal_deadline_ledger;
    env.ledger()
        .with_mut(|l| l.sequence_number = appeal_deadline_ledger + 1);

    let status = client.finalize_appeal(&cid);
    assert_eq!(
        status,
        ClaimStatus::AppealRejected,
        "no appeal votes were cast, so quorum is unmet and the default outcome applies"
    );
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::AppealRejected);
}

/// Issue #1314: appeal-round duplicate-vote tracking is scoped per
/// `(claim_id, voter)` (`DataKey::AppealVote`) and therefore independent of the
/// base-claim vote tracking (`DataKey::Vote`). A second `vote_on_appeal` from
/// the same voter in the same round must be rejected as `DuplicateVote`, while
/// a voter who already voted in the base round is still allowed to cast an
/// appeal-round vote.
#[test]
fn appeal_votes_are_immutable_and_scoped_per_round() {
    let (_env, client, v1, v2, _v3, cid) = rejected_and_appealed();

    // v1 casts the first appeal-round vote (claimants may vote in appeals).
    let status = client.vote_on_appeal(&v1, &cid, &VoteOption::Approve);
    assert_eq!(
        status,
        ClaimStatus::UnderAppeal,
        "a single vote must not resolve the appeal (3-voter round needs all 3 at 75% quorum)"
    );

    // A second vote in the same round — even the opposite option — is rejected.
    let err = client
        .try_vote_on_appeal(&v1, &cid, &VoteOption::Reject)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::DuplicateVote);

    // v2 already voted Reject in the BASE round — that must not block an
    // appeal-round vote (per-round tracking keys are distinct).
    let status = client.vote_on_appeal(&v2, &cid, &VoteOption::Approve);
    assert_eq!(status, ClaimStatus::UnderAppeal);

    // Base-round and appeal-round tallies stay independent.
    let claim = client.get_claim(&cid);
    assert_eq!(claim.approve_votes, 0, "base approve tally untouched");
    assert_eq!(claim.reject_votes, 2, "base reject votes (v1 + v2) preserved");
    assert_eq!(claim.appeal_approve_votes, 2);
    assert_eq!(claim.appeal_reject_votes, 0);
}

/// Issue #1315: `vote_on_appeal` rejects votes cast after the appeal has
/// already resolved (quorum reached mid-vote, per the `vote_on_appeal` doc
/// comment). In a four-voter round with the default 75% appeal quorum the
/// third vote hits quorum and resolves the appeal immediately, so the fourth
/// voter's late ballot is refused with `ClaimAlreadyTerminal`.
#[test]
fn late_vote_after_appeal_resolved_mid_vote_is_rejected() {
    let (_env, client, _admin, _token) = setup();
    let v1 = Address::generate(&_env);
    let v2 = Address::generate(&_env);
    let v3 = Address::generate(&_env);
    let v4 = Address::generate(&_env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);
    seed(&client, &v4, 1_000_000, 500_000);

    // Base round: 2 of 4 reject (default 50% quorum ⇒ quorum met) → Rejected.
    let cid = file(&client, &v1, 100_000, &_env);
    client.vote_on_claim(&v1, &cid, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);

    client.open_appeal(&v1, &cid);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::UnderAppeal);

    // Four-voter appeal round at 75% quorum needs 3 of 4 to resolve.
    let status = client.vote_on_appeal(&v1, &cid, &VoteOption::Approve);
    assert_eq!(status, ClaimStatus::UnderAppeal);
    let status = client.vote_on_appeal(&v2, &cid, &VoteOption::Approve);
    assert_eq!(status, ClaimStatus::UnderAppeal);

    // The third vote reaches quorum and resolves the appeal immediately —
    // while the round is still in progress.
    let status = client.vote_on_appeal(&v3, &cid, &VoteOption::Approve);
    assert_eq!(status, ClaimStatus::AppealApproved);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::AppealApproved);

    // v4 was in the appeal snapshot but is now too late — the round is over.
    let err = client
        .try_vote_on_appeal(&v4, &cid, &VoteOption::Approve)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::ClaimAlreadyTerminal);
}

/// Issue #1316: the appeal-round quorum snapshot (`AppealClaimQuorumBps`) is
/// scoped per `claim_id`. Two claims whose appeals open under different
/// admin-configured elevated-quorum settings keep isolated snapshots, and a
/// later admin change must not retroactively alter an earlier claim's snapshot.
#[test]
fn appeal_quorum_snapshot_is_scoped_per_claim() {
    let (env, client, _admin, _token) = setup();
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);
    let v4 = Address::generate(&env);
    seed(&client, &v1, 1_000_000, 500_000);
    seed(&client, &v2, 1_000_000, 500_000);
    seed(&client, &v3, 1_000_000, 500_000);
    seed(&client, &v4, 1_000_000, 500_000);

    // Claim A (filed by v1): appeal opens under the default elevated quorum.
    let cid_a = file(&client, &v1, 100_000, &env);
    client.vote_on_claim(&v1, &cid_a, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid_a, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid_a).status, ClaimStatus::Rejected);
    client.open_appeal(&v1, &cid_a);

    // Admin raises the elevated quorum before claim B's appeal opens.
    client.admin_set_elevated_quorum_bps(&10_000u32);

    // Claim B (filed by v4): appeal opens under the raised elevated quorum.
    let cid_b = file(&client, &v4, 100_000, &env);
    client.vote_on_claim(&v1, &cid_b, &VoteOption::Reject);
    client.vote_on_claim(&v2, &cid_b, &VoteOption::Reject);
    assert_eq!(client.get_claim(&cid_b).status, ClaimStatus::Rejected);
    client.open_appeal(&v4, &cid_b);

    // Snapshots are per-claim and immutable once frozen.
    let quorum_a = env.as_contract(&client.address, || {
        niffyinsure::storage::get_appeal_claim_quorum_bps(&env, cid_a)
    });
    let quorum_b = env.as_contract(&client.address, || {
        niffyinsure::storage::get_appeal_claim_quorum_bps(&env, cid_b)
    });
    assert_eq!(quorum_a, 7_500, "claim A froze the default 75% elevated quorum");
    assert_eq!(quorum_b, 10_000, "claim B froze the raised 100% elevated quorum");

    // Behavioral proof of isolation: claim A resolves once 3 of 4 vote
    // (3 >= ceil(4 * 75%)), while claim B — also at 3 of 4 — stays open
    // (3 < ceil(4 * 100%)), so the snapshots genuinely apply per claim.
    let status = client.vote_on_appeal(&v1, &cid_a, &VoteOption::Approve);
    assert_eq!(status, ClaimStatus::UnderAppeal, "1/4 votes: below A's 75% quorum");
    let status = client.vote_on_appeal(&v2, &cid_a, &VoteOption::Approve);
    assert_eq!(status, ClaimStatus::UnderAppeal, "2/4 votes: below A's 75% quorum");
    let status = client.vote_on_appeal(&v3, &cid_a, &VoteOption::Approve);
    assert_eq!(
        status,
        ClaimStatus::AppealApproved,
        "3/4 votes meets A's frozen 75% quorum"
    );

    let status = client.vote_on_appeal(&v1, &cid_b, &VoteOption::Approve);
    assert_eq!(status, ClaimStatus::UnderAppeal);
    let status = client.vote_on_appeal(&v2, &cid_b, &VoteOption::Approve);
    assert_eq!(status, ClaimStatus::UnderAppeal);
    let status = client.vote_on_appeal(&v3, &cid_b, &VoteOption::Approve);
    assert_eq!(
        status,
        ClaimStatus::UnderAppeal,
        "3/4 votes must NOT meet B's frozen 100% quorum — snapshots are per claim"
    );
    assert_eq!(client.get_claim(&cid_b).status, ClaimStatus::UnderAppeal);
}

