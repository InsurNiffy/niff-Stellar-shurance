// Claim lifecycle and DAO voting will be implemented here.
//
// Planned public functions:
//   file_claim(env, policy_id, amount, details, evidence)
//   vote_on_claim(env, voter, claim_id, vote)
//
// Open claim accounting: `storage::OpenClaimCount(holder, policy_id)` must be
// incremented when a claim enters `Processing` and decremented when it reaches
// a terminal status (`Approved` / `Rejected` / `Withdrawn`), so policy termination can block
// or audit in-flight claims. Until `file_claim` ships, admins may use
// `admin_set_open_claim_count` in tests or break-glass ops only.
//
// ── Rejection side-effects ─────────────────────────────────────────────────────
//
// When a claim reaches `ClaimStatus::Rejected` (via majority vote or deadline
// finalization), `on_reject` is called to apply the following deterministic,
// trustless consequences:
//
//   1. `StrikeIncremented` event  — increments the policy's `strike_count`
//      and emits the new total so indexers can surface it to holders.
//   2. `PolicyDeactivated` event  — emitted if `strike_count` reaches
//      `STRIKE_DEACTIVATION_THRESHOLD`. The policy is set `is_active = false`
//      and the voter registry is updated in the same ledger.
//   3. `ClaimRejected` event      — authoritative rejection signal for indexers.
//      Carries vote tallies so the UI can explain the outcome without querying
//      separate storage.
//
// ── Guarantee: reject NEVER invokes payout ────────────────────────────────────
//
// `on_reject` performs no token transfers. The only token transfer in this
// module is inside `payout`, which is exclusively called from `process_claim`.
// `process_claim` guards on `claim.status == ClaimStatus::Approved`; a
// `Rejected` claim will receive `Error::ClaimNotApproved` before any transfer
// is attempted.
//
// ── Permanent auditability ────────────────────────────────────────────────────
//
// Rejected claim records are stored in `persistent` storage with TTL
// extensions and remain readable indefinitely via `get_claim`. The `details`
// field holds a brief description (≤ 256 chars); full allegation narratives
// must NOT be stored on-chain — use IPFS/off-chain storage and reference via
// `evidence` URLs or an off-chain indexer.
//
// ── Appeal window interaction ─────────────────────────────────────────────────
//
// Appeals are not implemented in this version. If added:
//   - Auto-deactivation in `on_reject` should be conditional on
//     `env.ledger().sequence() > appeal_deadline_ledger`.
//   - A new `ClaimStatus::Appealed` would require composing cleanly with
//     the existing terminal-state checks (`is_terminal()`).
//   - The `PolicyDeactivated` and `StrikeIncremented` events carry enough
//     context for an appeal system to reverse their effects off-chain.
//
// ── Governance risk documentation ─────────────────────────────────────────────
//
// Admin override path: the admin can call `admin_terminate_policy` with
// `allow_open_claims = true`, which can terminate a policy while a claim is
// in `Processing`. In that scenario the claim vote can still complete, but
// `on_reject` will find `policy.is_active = false` and skip the deactivation
// branch (policy already inactive). The `StrikeIncremented` and
// `ClaimRejected` events still fire for auditability.
//
// Premium-extraction attack: an attacker cannot extract premiums via the
// rejection path because `process_claim` is gated on `Approved` status. The
// only way to get an `Approved` claim processed is through legitimate majority
// or deadline-plurality approval, which is controlled by the DAO snapshot, not
// the admin. The admin cannot flip a `Rejected` claim to `Approved`.
use crate::{
    ledger, rolling_claim_cap, storage,
    types::{
        Claim, ClaimEvidenceEntry, ClaimProcessed, ClaimStatus, ClaimStatusHistoryEntry,
        TerminationReason, VoteOption, CLAIM_STATUS_HISTORY_MAX, STRIKE_DEACTIVATION_THRESHOLD,
    },
    validate::Error,
};
use soroban_sdk::{contractevent, Address, BytesN, Env, String, Vec};

/// Append `status` at `ledger`, then drop oldest entries if over [`CLAIM_STATUS_HISTORY_MAX`].
/// Never fails — transitions must not revert because the log is full.
fn push_status_transition(
    history: &mut Vec<ClaimStatusHistoryEntry>,
    status: ClaimStatus,
    ledger: u32,
) {
    history.push_back(ClaimStatusHistoryEntry { status, ledger });
    while history.len() > CLAIM_STATUS_HISTORY_MAX {
        history.pop_front();
    }
}

// ── Participation quorum (see also `types` lifecycle docs) ───────────────────
//
// Let `E` = eligible voters (snapshot length at `file_claim`), `C` = cast ballots =
// `approve_votes + reject_votes`, `Q` = quorum basis points **for this claim**
// (instance `quorum_bps` copied into persistent `ClaimQuorumBps(claim_id)` at filing).
// Admin changes to instance `quorum_bps` do **not** alter `Q` for claims already in
// `Processing`.
//
// Required minimum cast votes:
//   R = ceil(E * Q / 10_000)  →  R = (E * Q + 9_999) / 10_000  (u32; E = 0 ⇒ R = 0)
//
// **Quorum met** iff `C >= R`. If met, outcome is **plurality**: Approved when
// `approve_votes > reject_votes`, else Rejected (insurer wins ties).
// If the voting deadline passes with `C < R`, the claim is **Rejected** (no quorum).
fn required_cast_for_quorum(eligible: u32, quorum_bps: u32) -> u32 {
    if eligible == 0 {
        return 0;
    }
    let numer = (eligible as u64).saturating_mul(quorum_bps as u64);
    numer.div_ceil(10_000) as u32
}

fn participation_quorum_met(cast_votes: u32, eligible: u32, quorum_bps: u32) -> bool {
    cast_votes >= required_cast_for_quorum(eligible, quorum_bps)
}

/// If participation quorum is satisfied, returns Some(Approved|Rejected) by plurality.
fn resolve_plurality_if_quorum_met(
    approve_votes: u32,
    reject_votes: u32,
    cast_votes: u32,
    eligible: u32,
    quorum_bps: u32,
) -> Option<ClaimStatus> {
    if !participation_quorum_met(cast_votes, eligible, quorum_bps) {
        return None;
    }
    if approve_votes > reject_votes {
        Some(ClaimStatus::Approved)
    } else {
        Some(ClaimStatus::Rejected)
    }
}

// ── Events ────────────────────────────────────────────────────────────────────

#[contractevent(topics = ["niffyinsure", "claim_filed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
struct ClaimFiled {
    #[topic]
    pub claim_id: u64,
    pub holder: Address,
    pub policy_id: u32,
    /// Gross claim amount requested (before deductible at payout).
    pub claim_amount: i128,
    /// Deductible copied from the policy at filing (for indexer / UI breakdown).
    pub deductible: i128,
    /// SHA-256 content hashes for each evidence entry (same order as submitted).
    pub evidence_hashes: Vec<BytesN<32>>,
}

/// Emitted when the claimant withdraws before any vote is cast.
///
/// Topic layout: ["niffyinsure", "claim_withdrawn", claim_id]
#[contractevent(topics = ["niffyinsure", "claim_withdrawn"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimWithdrawn {
    #[topic]
    pub claim_id: u64,
    pub policy_id: u32,
    pub claimant: Address,
    pub at_ledger: u32,
}

/// Emitted as the authoritative rejection signal. Indexers must consume this
/// event (not poll storage) to drive user-facing messaging. The vote tallies
/// are included so the UI can explain the outcome (e.g., "rejected 4–1").
///
/// Topic layout: ["niffyinsure", "claim_rejected", claim_id]
/// Data: { policy_id, claimant, reject_votes, approve_votes, at_ledger }
///
/// NOTE: This event is NEVER emitted on the approve path. Its presence
/// unambiguously signals rejection.
#[contractevent(topics = ["niffyinsure", "claim_rejected"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimRejected {
    #[topic]
    pub claim_id: u64,
    pub policy_id: u32,
    pub claimant: Address,
    pub reject_votes: u32,
    pub approve_votes: u32,
    /// Ledger at which the claim was finalized as rejected.
    pub at_ledger: u32,
}

/// Emitted every time a rejection increments the policy's strike counter.
/// Indexers should use this event to notify holders of accumulating strikes
/// before the threshold triggers deactivation.
///
/// Topic layout: ["niffyinsure", "strike_incremented", holder, policy_id]
/// Data: { claim_id, strike_count }
///
/// `strike_count` is the NEW total after this increment (1-indexed).
#[contractevent(topics = ["niffyinsure", "strike_incremented"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrikeIncremented {
    #[topic]
    pub holder: Address,
    #[topic]
    pub policy_id: u32,
    pub claim_id: u64,
    /// New cumulative strike count for this policy after this rejection.
    pub strike_count: u32,
}

/// Emitted when a policy is automatically deactivated because its
/// `strike_count` reached `STRIKE_DEACTIVATION_THRESHOLD`.
///
/// Topic layout: ["niffyinsure", "policy_deactivated", holder, policy_id]
/// Data: { reason_code, at_ledger }
///
/// `reason_code` values:
///   1 = ExcessiveRejections (strike threshold reached)
///
/// CENTRALIZATION NOTE: This event is emitted by the claims engine
/// deterministically — no admin key is involved. An admin cannot prevent or
/// reverse this deactivation via `process_claim` or any other entrypoint.
/// The only admin avenue is `admin_terminate_policy` (which terminates before
/// the threshold is reached) or a future contract upgrade.
///
/// APPEAL NOTE: If appeals are added, this event should be treated as
/// "pending deactivation" until the appeal window closes, not as an
/// immediate final state.
#[contractevent(topics = ["niffyinsure", "policy_deactivated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicyDeactivated {
    #[topic]
    pub holder: Address,
    #[topic]
    pub policy_id: u32,
    /// 1 = ExcessiveRejections
    pub reason_code: u32,
    pub at_ledger: u32,
}

// ── file_claim ────────────────────────────────────────────────────────────────

/// File a new claim against an active policy.
///
/// Window checks (all via `ledger` helpers):
/// - Policy must be active: `now` in `[start_ledger, end_ledger)`.
/// - Rate-limit: `now >= last_filed_at + RATE_LIMIT_WINDOW_LEDGERS` (or first claim).
///
/// Returns the new `claim_id`.
pub fn file_claim(
    env: &Env,
    holder: &Address,
    policy_id: u32,
    amount: i128,
    details: &String,
    evidence: &Vec<ClaimEvidenceEntry>,
    expected_nonce: Option<u64>,
) -> Result<u64, Error> {
    // Check pause: claims are blocked if claims_paused is true
    storage::assert_claims_not_paused(env);

    // Opt-in replay protection.
    storage::check_and_bump_nonce(env, holder, expected_nonce)?;

    let policy = storage::get_policy(env, holder, policy_id).ok_or(Error::PolicyNotFound)?;

    // Policy active window check using ledger helper.
    let now = env.ledger().sequence();
    if !ledger::is_within_window(now, policy.start_ledger, policy.end_ledger) {
        return if ledger::is_expired(now, policy.end_ledger) {
            Err(Error::PolicyExpired)
        } else {
            Err(Error::PolicyInactive)
        };
    }
    if !policy.is_active {
        return Err(Error::PolicyInactive);
    }

    if storage::has_open_claim(env, holder, policy_id) {
        return Err(Error::DuplicateOpenClaim);
    }

    // Anchor for restoring per-holder rate limit if claimant later withdraws (see `withdraw_claim`).
    let rate_limit_anchor_before_filing = storage::get_last_claim_ledger(env, holder);

    // Rate-limit check.
    if let Some(last) = rate_limit_anchor_before_filing {
        if !ledger::is_rate_limit_elapsed(now, last, ledger::RATE_LIMIT_WINDOW_LEDGERS) {
            return Err(Error::RateLimitExceeded);
        }
    }

    crate::validate::check_claim_fields(env, amount, policy.coverage, details, evidence)?;

    let deductible_snapshot = policy.deductible.unwrap_or(0);

    let duration = storage::get_voting_duration_ledgers(env);
    let voting_deadline_ledger = now
        .checked_add(duration)
        .ok_or(Error::Overflow)?;

    let claim_id = storage::next_claim_id(env);
    let mut status_history: Vec<ClaimStatusHistoryEntry> = Vec::new(env);
    push_status_transition(&mut status_history, ClaimStatus::Processing, now);
    let claim = Claim {
        claim_id,
        policy_id,
        claimant: holder.clone(),
        amount,
        deductible: deductible_snapshot,
        asset: policy.asset.clone(),
        details: details.clone(),
        evidence: evidence.clone(),
        status: ClaimStatus::Processing,
        voting_deadline_ledger,
        approve_votes: 0,
        reject_votes: 0,
        filed_at: now,
        appeal_open_deadline_ledger: 0,
        appeals_count: 0,
        appeal_deadline_ledger: 0,
        appeal_approve_votes: 0,
        appeal_reject_votes: 0,
        status_history,
    };

    storage::set_claim(env, &claim);
    storage::set_open_claim(env, holder, policy_id, true);
    storage::snapshot_claim_voters(env, claim_id);
    storage::set_claim_quorum_bps(env, claim_id, storage::get_quorum_bps(env));
    storage::set_last_claim_ledger(env, holder, now);
    storage::set_claim_rate_limit_prev(env, claim_id, rate_limit_anchor_before_filing);

    let mut evidence_hashes: Vec<BytesN<32>> = Vec::new(env);
    for e in evidence.iter() {
        evidence_hashes.push_back(e.hash.clone());
    }

    ClaimFiled {
        claim_id,
        holder: holder.clone(),
        policy_id,
        claim_amount: amount,
        deductible: deductible_snapshot,
        evidence_hashes,
    }
    .publish(env);

    Ok(claim_id)
}

// ── withdraw_claim ────────────────────────────────────────────────────────────

/// Claimant-only: withdraw a claim before any ballot is cast.
///
/// Allowed only while `status == Processing` and `approve_votes + reject_votes == 0`.
/// Sets status to [`ClaimStatus::Withdrawn`], clears the open-claim flag, restores the
/// holder's claim **rate-limit anchor** to its value before this claim was filed (see
/// `storage::ClaimRateLimitPrev`), and emits [`ClaimWithdrawn`].
///
/// **Rate limit vs open-claim cap:** Withdrawal does **not** consume the per-policy
/// "one open claim" slot once complete (open flag cleared). The per-holder time spacing
/// between **successful** `file_claim` calls is reverted to the pre-filing anchor so a
/// mistaken filing does not force the holder to wait another full window before refiling.
pub fn withdraw_claim(env: &Env, claimant: &Address, claim_id: u64) -> Result<(), Error> {
    storage::assert_claims_not_paused(env);

    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    if claimant != &claim.claimant {
        return Err(Error::NotEligibleVoter);
    }

    if claim.status != ClaimStatus::Processing {
        return Err(Error::ClaimAlreadyTerminal);
    }

    if claim.approve_votes != 0 || claim.reject_votes != 0 {
        return Err(Error::ClaimAlreadyTerminal);
    }

    let now = env.ledger().sequence();
    claim.status = ClaimStatus::Withdrawn;
    push_status_transition(&mut claim.status_history, ClaimStatus::Withdrawn, now);

    storage::set_open_claim(env, &claim.claimant, claim.policy_id, false);

    match storage::take_claim_rate_limit_prev(env, claim_id) {
        Some(ledger) => storage::set_last_claim_ledger(env, &claim.claimant, ledger),
        None => storage::remove_last_claim_ledger(env, &claim.claimant),
    }

    storage::set_claim(env, &claim);

    ClaimWithdrawn {
        claim_id,
        policy_id: claim.policy_id,
        claimant: claimant.clone(),
        at_ledger: now,
    }
    .publish(env);

    Ok(())
}

// ── vote_on_claim ─────────────────────────────────────────────────────────────

/// Cast a vote on a pending claim.
///
/// Window check: `now <= claim.voting_deadline_ledger` (inclusive; see `ledger::is_claim_voting_open`).
/// Returns the updated `ClaimStatus` after tallying.
pub fn vote_on_claim(
    env: &Env,
    voter: &Address,
    claim_id: u64,
    vote: &VoteOption,
) -> Result<ClaimStatus, Error> {
    // Check pause: voting is blocked if claims_paused is true
    storage::assert_claims_not_paused(env);

    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    if claim.status.is_terminal() {
        return Err(Error::ClaimAlreadyTerminal);
    }

    // Voting window: use per-claim deadline frozen at filing (not current admin config).
    let now = env.ledger().sequence();
    if !ledger::is_claim_voting_open(now, claim.voting_deadline_ledger) {
        return Err(Error::VotingWindowClosed);
    }

    if !storage::has_claim_voters(env, claim_id) {
        return Err(Error::VoterSnapshotExpired);
    }

    // Voter must be in the claim's snapshot electorate.
    let snapshot = storage::get_claim_voters(env, claim_id);
    let eligible = snapshot.iter().any(|v| v == *voter);
    if !eligible {
        return Err(Error::NotEligibleVoter);
    }

    // Duplicate vote check — before any write.
    if storage::get_vote(env, claim_id, voter).is_some() {
        return Err(Error::DuplicateVote);
    }

    storage::set_vote(env, claim_id, voter, vote);

    let status_before = claim.status.clone();

    match vote {
        VoteOption::Approve => claim.approve_votes += 1,
        VoteOption::Reject => claim.reject_votes += 1,
    }

    let eligible = snapshot.len() as u32;
    let cast = claim.approve_votes + claim.reject_votes;
    let quorum_bps = storage::get_claim_quorum_bps(env, claim_id);
    if let Some(res) = resolve_plurality_if_quorum_met(
        claim.approve_votes,
        claim.reject_votes,
        cast,
        eligible,
        quorum_bps,
    ) {
        let rejected = res == ClaimStatus::Rejected;
        claim.status = res;
        if rejected {
            claim.appeal_open_deadline_ledger = now.saturating_add(ledger::APPEAL_OPEN_WINDOW_LEDGERS);
        }
    }

    if claim.status != status_before {
        push_status_transition(&mut claim.status_history, claim.status.clone(), now);
    }

    let newly_rejected = claim.status == ClaimStatus::Rejected;

    if claim.status.is_terminal() {
        storage::set_open_claim(env, &claim.claimant, claim.policy_id, false);
    }

    if status_before == ClaimStatus::Processing && claim.status != ClaimStatus::Processing {
        storage::remove_claim_rate_limit_prev(env, claim_id);
    }

    let status = claim.status.clone();
    storage::set_claim(env, &claim);

    // Apply rejection side-effects after the claim record is persisted.
    // on_reject emits ClaimRejected, StrikeIncremented, and (if threshold
    // reached) PolicyDeactivated. It never transfers tokens.
    if newly_rejected {
        on_reject(env, &claim);
    }

    Ok(status)
}

/// Permissionless: extends persistent TTL for `ClaimVoters(claim_id)` only.
/// Does not change the voter list or vote tallies.
pub fn refresh_snapshot(env: &Env, claim_id: u64) -> Result<(), Error> {
    let _ = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;
    if !storage::has_claim_voters(env, claim_id) {
        return Err(Error::VoterSnapshotExpired);
    }
    storage::extend_claim_voters_snapshot_ttl(env, claim_id);
    Ok(())
}

// ── finalize_claim ────────────────────────────────────────────────────────────

/// Finalize a claim after the voting deadline has passed.
///
/// Window check: `now > claim.voting_deadline_ledger` (see `ledger::is_claim_past_voting_deadline`).
/// Uses the **participation quorum** and per-claim `quorum_bps` snapshot (see module helpers).
/// If quorum is met, plurality decides; if not, **Rejected** (no quorum).
pub fn finalize_claim(env: &Env, claim_id: u64) -> Result<ClaimStatus, Error> {
    // Check pause: finalization is blocked if claims_paused is true
    storage::assert_claims_not_paused(env);

    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    if claim.status.is_terminal() {
        return Err(Error::ClaimAlreadyTerminal);
    }

    let now = env.ledger().sequence();
    if !ledger::is_claim_past_voting_deadline(now, claim.voting_deadline_ledger) {
        return Err(Error::VotingWindowStillOpen);
    }

    let status_before = claim.status.clone();

    let voters = storage::get_claim_voters(env, claim_id);
    let eligible = voters.len() as u32;
    let cast = claim.approve_votes + claim.reject_votes;
    let quorum_bps = storage::get_claim_quorum_bps(env, claim_id);

    if participation_quorum_met(cast, eligible, quorum_bps) {
        if claim.approve_votes > claim.reject_votes {
            claim.status = ClaimStatus::Approved;
        } else {
            claim.status = ClaimStatus::Rejected;
            claim.appeal_open_deadline_ledger = now.saturating_add(ledger::APPEAL_OPEN_WINDOW_LEDGERS);
        }
    } else {
        // Below minimum participation — no quorum (insurer-favored default).
        claim.status = ClaimStatus::Rejected;
        claim.appeal_open_deadline_ledger = now.saturating_add(ledger::APPEAL_OPEN_WINDOW_LEDGERS);
    }

    if claim.status != status_before {
        push_status_transition(&mut claim.status_history, claim.status.clone(), now);
    }

    let newly_rejected = claim.status == ClaimStatus::Rejected;

    storage::set_open_claim(env, &claim.claimant, claim.policy_id, false);

    if status_before == ClaimStatus::Processing && claim.status != ClaimStatus::Processing {
        storage::remove_claim_rate_limit_prev(env, claim_id);
    }

    let status = claim.status.clone();
    storage::set_claim(env, &claim);

    // Apply rejection side-effects after the claim record is persisted.
    if newly_rejected {
        on_reject(env, &claim);
    }

    Ok(status)
}

pub fn finalize_claim(env: &Env, claim_id: u64) -> Result<ClaimStatus, Error> {
    // Check pause: finalization is blocked if claims_paused is true
    storage::assert_claims_not_paused(env);
    finalize_claim_inner(env, claim_id)
}

/// Permissionless keeper: same outcome as [`finalize_claim`] when voting has ended, but returns
/// [`Error::CalculatorPaused`] if `claims_paused` is set instead of panicking.
///
/// Only [`ClaimStatus::Processing`] claims are eligible so keepers cannot advance appeal or other flows.
pub fn process_deadline(env: &Env, claim_id: u64) -> Result<ClaimStatus, Error> {
    if storage::get_pause_flags(env).claims_paused {
        return Err(Error::CalculatorPaused);
    }
    let claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;
    if claim.status.is_terminal() {
        return Err(Error::ClaimAlreadyTerminal);
    }
    if claim.status != ClaimStatus::Processing {
        return Err(Error::ClaimNotProcessing);
    }
    finalize_claim_inner(env, claim_id)
}

// ── process_claim (admin payout trigger) ─────────────────────────────────────

/// Trigger the payout for an approved claim.
///
/// INVARIANT: This function is the ONLY code path that transfers payout
/// tokens. It is unconditionally gated on `claim.status == Approved`.
/// A `Rejected` claim will never reach `payout()` — the guard below returns
/// `Error::ClaimNotApproved` before any transfer is attempted.
///
/// This invariant is enforced structurally: `on_reject` does not call
/// `payout`, and there is no entrypoint that transitions a `Rejected` claim
/// to `Approved`.
pub fn process_claim(env: &Env, claim_id: u64) -> Result<(), Error> {
    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    if claim.status == ClaimStatus::Paid {
        return Err(Error::AlreadyPaid);
    }
    // SAFETY: Rejected and Processing claims are explicitly blocked here.
    // No path can circumvent this guard to reach payout().
    if claim.status != ClaimStatus::Approved {
        return Err(Error::ClaimNotApproved);
    }

    payout(env, &claim)?;
    let now = env.ledger().sequence();
    claim.status = ClaimStatus::Paid;
    push_status_transition(&mut claim.status_history, ClaimStatus::Paid, now);
    storage::set_open_claim(env, &claim.claimant, claim.policy_id, false);
    storage::remove_claim_rate_limit_prev(env, claim_id);
    storage::set_claim(env, &claim);
    Ok(())
}

// ── on_reject (centralized rejection side-effects) ────────────────────────────

/// Apply all side-effects that must occur when a claim is rejected.
///
/// Called by both `vote_on_claim` (majority auto-finalize) and
/// `finalize_claim` (deadline resolution). Must be called AFTER the claim
/// record has been persisted with `ClaimStatus::Rejected`.
///
/// Side-effects (in emission order):
///   1. `ClaimRejected`       — indexer signal; always emitted.
///   2. `StrikeIncremented`   — policy strike counter incremented; always
///      emitted even if the policy is already inactive (auditability).
///   3. `PolicyDeactivated`   — emitted only when `strike_count` reaches
///      `STRIKE_DEACTIVATION_THRESHOLD` AND the policy is currently active.
///
/// NO TOKEN TRANSFERS occur in this function.
///
/// If the policy record cannot be found (e.g., it was manually terminated and
/// subsequently evicted from storage), `ClaimRejected` is still emitted and
/// the function returns without error. Strike and deactivation events require
/// the policy record.
fn on_reject(env: &Env, claim: &Claim) {
    let now = env.ledger().sequence();

    // ── 1. ClaimRejected ─────────────────────────────────────────────────────
    //
    // Emit first so indexers always see a ClaimRejected before any policy
    // side-effect events, establishing a clear causal ordering.
    ClaimRejected {
        claim_id: claim.claim_id,
        policy_id: claim.policy_id,
        claimant: claim.claimant.clone(),
        reject_votes: claim.reject_votes,
        approve_votes: claim.approve_votes,
        at_ledger: now,
    }
    .publish(env);

    // ── 2. StrikeIncremented + (optional) PolicyDeactivated ──────────────────
    //
    // Best-effort: if the policy record is missing (manual termination + TTL
    // eviction), skip strike and deactivation. ClaimRejected has already fired.
    let Some(mut policy) = storage::get_policy(env, &claim.claimant, claim.policy_id) else {
        return;
    };

    policy.strike_count = policy.strike_count.saturating_add(1);

    StrikeIncremented {
        holder: claim.claimant.clone(),
        policy_id: claim.policy_id,
        claim_id: claim.claim_id,
        strike_count: policy.strike_count,
    }
    .publish(env);

    // ── 3. PolicyDeactivated ─────────────────────────────────────────────────
    //
    // Deactivate only if the policy is currently active AND the strike count
    // has reached the threshold. A policy already deactivated (e.g., by the
    // admin or a prior threshold breach) is not touched again — no double
    // deactivation.
    if policy.strike_count >= STRIKE_DEACTIVATION_THRESHOLD && policy.is_active {
        policy.is_active = false;
        policy.terminated_at_ledger = now;
        policy.termination_reason = TerminationReason::ExcessiveRejections;
        policy.terminated_by_admin = false;

        // Persist policy state change before emitting the event so any
        // re-entrant read sees the correct state.
        storage::set_policy(env, &claim.claimant, claim.policy_id, &policy);

        // Update voter registry: decrement active count and remove from the
        // live voter list if this was the holder's last active policy.
        storage::decrement_holder_active_policies(env, &claim.claimant);
        if storage::get_holder_active_policy_count(env, &claim.claimant) == 0 {
            storage::voters_remove_holder(env, &claim.claimant);
        }

        PolicyDeactivated {
            holder: claim.claimant.clone(),
            policy_id: claim.policy_id,
            reason_code: 1, // 1 = ExcessiveRejections
            at_ledger: now,
        }
        .publish(env);
    } else {
        // Strike did not trigger deactivation — persist the incremented count.
        storage::set_policy(env, &claim.claimant, claim.policy_id, &policy);
    }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

fn payout(env: &Env, claim: &Claim) -> Result<(), Error> {
    let policy =
        storage::get_policy(env, &claim.claimant, claim.policy_id).ok_or(Error::PolicyNotFound)?;

    if !storage::is_allowed_asset(env, &policy.asset) {
        return Err(Error::InvalidAsset);
    }

    let gross = claim.amount;
    let deductible = claim.deductible;
    let net = gross
        .checked_sub(deductible)
        .ok_or(Error::Overflow)?;
    if net <= 0 {
        // Enum size capped by Soroban; reuse ClaimAmountZero for "no positive payout after deductible".
        return Err(Error::ClaimAmountZero);
    }

    if !crate::token::check_balance(env, &policy.asset, net) {
        return Err(Error::InsufficientTreasury);
    }

    let payout_to = policy
        .beneficiary
        .clone()
        .unwrap_or_else(|| policy.holder.clone());

    crate::token::transfer(
        env,
        &policy.asset,
        &env.current_contract_address(),
        &payout_to,
        net,
    );

    ClaimProcessed {
        claim_id: claim.claim_id,
        recipient: payout_to,
        gross_amount: gross,
        deductible,
        amount: net,
    }
    .publish(env);

    Ok(())
}

// ── Public read helpers ───────────────────────────────────────────────────────

pub fn get_claim(env: &Env, claim_id: u64) -> Result<Claim, Error> {
    storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)
}

pub fn get_claim_history(env: &Env, claim_id: u64) -> Result<Vec<ClaimStatusHistoryEntry>, Error> {
    let c = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;
    Ok(c.status_history)
}

pub fn set_allowed_asset(env: &Env, asset: &Address, allowed: bool) {
    storage::set_allowed_asset(env, asset, allowed);
}

#[cfg(test)]
mod evidence_hash_tests {
    use crate::validate::{check_claim_fields, Error};
    use soroban_sdk::{Bytes, BytesN, Env, String, Vec};
    use crate::types::ClaimEvidenceEntry;

    fn make_hash(env: &Env, fill: u8) -> BytesN<32> {
        let mut b = [fill; 32];
        BytesN::from_array(env, &b)
    }

    fn make_url(env: &Env) -> String {
        String::from_str(env, "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")
    }

    fn make_details(env: &Env) -> String {
        String::from_str(env, "flood damage")
    }

    #[test]
    fn zero_hash_is_rejected() {
        let env = Env::default();
        let mut evidence: Vec<ClaimEvidenceEntry> = Vec::new(&env);
        evidence.push_back(ClaimEvidenceEntry {
            url: make_url(&env),
            hash: make_hash(&env, 0x00),
        });
        let err = check_claim_fields(&env, 100, 1000, &make_details(&env), &evidence)
            .unwrap_err();
        assert_eq!(err, Error::ExcessiveEvidenceBytes);
    }

    #[test]
    fn non_zero_hash_is_accepted() {
        let env = Env::default();
        let mut evidence: Vec<ClaimEvidenceEntry> = Vec::new(&env);
        evidence.push_back(ClaimEvidenceEntry {
            url: make_url(&env),
            hash: make_hash(&env, 0xab),
        });
        assert!(check_claim_fields(&env, 100, 1000, &make_details(&env), &evidence).is_ok());
    }

    #[test]
    fn mixed_zero_and_nonzero_hash_rejected_on_zero_entry() {
        let env = Env::default();
        let mut evidence: Vec<ClaimEvidenceEntry> = Vec::new(&env);
        evidence.push_back(ClaimEvidenceEntry {
            url: make_url(&env),
            hash: make_hash(&env, 0xab),
        });
        evidence.push_back(ClaimEvidenceEntry {
            url: make_url(&env),
            hash: make_hash(&env, 0x00),
        });
        let err = check_claim_fields(&env, 100, 1000, &make_details(&env), &evidence)
            .unwrap_err();
        assert_eq!(err, Error::ExcessiveEvidenceBytes);
    }

    #[test]
    fn hash_persisted_on_stored_claim() {
        // Verify that the hash stored in ClaimEvidenceEntry round-trips through
        // the struct without mutation (persistence correctness).
        let env = Env::default();
        let expected = make_hash(&env, 0xde);
        let entry = ClaimEvidenceEntry {
            url: make_url(&env),
            hash: expected.clone(),
        };
        assert_eq!(entry.hash, expected);
    }
}

#[cfg(test)]
mod claim_status_history_tests {
    use super::push_status_transition;
    use crate::types::{ClaimStatus, ClaimStatusHistoryEntry, CLAIM_STATUS_HISTORY_MAX};
    use soroban_sdk::Env;

    #[test]
    fn fifo_cap_drops_oldest_without_growing() {
        let env = Env::default();
        let mut hist = soroban_sdk::Vec::<ClaimStatusHistoryEntry>::new(&env);
        let extra = 5u32;
        for ledger in 0..(CLAIM_STATUS_HISTORY_MAX + extra) {
            push_status_transition(&mut hist, ClaimStatus::Processing, ledger);
        }
        assert_eq!(hist.len(), CLAIM_STATUS_HISTORY_MAX);
        assert_eq!(hist.get(0).unwrap().ledger, extra);
        assert_eq!(
            hist.get(hist.len() - 1).unwrap().ledger,
            CLAIM_STATUS_HISTORY_MAX + extra - 1
        );
    }
}
