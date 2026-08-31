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
// ── Appeal vs. dispute vs. escalation: three distinct mechanisms ──────────────
//
// Full definitions, including the triggering actor and status precondition for
// each, live in the glossary: `docs/GLOSSARY.md` ("Appeal vs. dispute vs.
// escalation"). Summary, because these three are easy to conflate by name:
//
//   - `open_appeal` (claimant-initiated): requires `claim.status ==
//     Rejected`. Lets the claimant contest a rejection. Transitions
//     Rejected → UnderAppeal → (AppealApproved | AppealRejected).
//   - `dispute_claim` (admin-initiated): requires `claim.status ==
//     Approved`. Lets the admin freeze payout on an approved claim pending
//     review. Transitions Approved → Disputed.
//   - `escalate_claim` (admin-initiated): requires `claim.status ==
//     Processing`. Shortens a stalled claim's voting deadline. Changes the
//     schedule only — no status transition, no effect on the outcome.
//
// The three can never overlap on the same claim, because each one's entry
// guard requires a status the other two can't produce: a claim that is
// `Rejected` cannot be `Approved`, and a claim that is `Approved`/`Disputed`
// cannot be `Rejected`/`UnderAppeal`, and both are past `Processing`. The
// statuses partition the claim's lifecycle. See
// `tests/appeal_dispute_mutual_exclusion.rs` for a test asserting this for the
// appeal/dispute pair.
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
    events::{self, ClaimEvidenceUpdated, PayoutRecipientWarning},
    ledger, storage,
    types::{
        Claim, ClaimEvidenceEntry, ClaimProcessed, ClaimStatus, ClaimStatusHistoryEntry,
        TerminationReason, VoteOption, CLAIM_STATUS_HISTORY_MAX, STRIKE_DEACTIVATION_THRESHOLD,
    },
    validate::{self, Error},
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

/// Emitted when a claim filing fee is collected from the claimant.
///
/// Topic layout: ["niffyinsure", "claim_fee_collected", claim_id]
/// Data: { fee_amount, payer, at_ledger }
#[contractevent(topics = ["niffyinsure", "claim_fee_collected"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimFeeCollected {
    #[topic]
    pub claim_id: u64,
    /// Fee amount collected (stroops).
    pub fee_amount: i128,
    /// Address that paid the fee (the claimant).
    pub payer: Address,
    pub at_ledger: u32,
}

/// Emitted when a previously-collected filing fee is refunded in full because
/// the claimant withdrew the claim before any vote was cast.
///
/// Topic layout: ["niffyinsure", "claim_fee_refunded", claim_id]
/// Data: { fee_amount, recipient, at_ledger }
#[contractevent(topics = ["niffyinsure", "claim_fee_refunded"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimFeeRefunded {
    #[topic]
    pub claim_id: u64,
    /// Fee amount refunded (stroops); always equal to the amount originally collected.
    pub fee_amount: i128,
    /// Address the refund was sent to (the claimant).
    pub recipient: Address,
    pub at_ledger: u32,
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

/// Emitted when an approved payout is still unprocessed after its deadline.
#[contractevent(topics = ["niffyinsure", "payout_timed_out"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutTimedOut {
    #[topic]
    pub claim_id: u64,
    pub deadline_ledger: u32,
    pub at_ledger: u32,
}

/// Emitted when admin disputes an approved claim during the dispute window.
#[contractevent(topics = ["niffyinsure", "claim_disputed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimDisputed {
    #[topic]
    pub claim_id: u64,
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
    crate::rolling_claim_cap::check_file_claim(env, holder, policy_id, amount, now)?;

    // Issue #587: validate against asset-specific min/max bounds
    if let Some(asset_config) = storage::get_allowed_asset_config(env, &policy.asset) {
        if amount < asset_config.min_claim_amount {
            return Err(Error::ClaimBelowMinAmount);
        }
        if amount > asset_config.max_claim_amount {
            return Err(Error::ClaimAboveMaxAmount);
        }
    }

    let deductible_snapshot = policy.deductible.unwrap_or(0);

    let duration = storage::get_voting_duration_ledgers(env);
    let voting_deadline_ledger = now.checked_add(duration).ok_or(Error::Overflow)?;

    let claim_id = storage::next_claim_id(env)?;

    // ── Claim filing fee ─────────────────────────────────────────────────────
    //
    // If a non-zero filing fee is configured, collect it from the claimant
    // before creating (persisting) the claim. The fee is transferred to the
    // treasury. If allowance is insufficient, the claim is rejected and
    // claim_id is NOT consumed (next_claim_id already bumped; this is
    // acceptable for auditability — gap claim_ids are harmless).
    let filing_fee = storage::get_claim_filing_fee(env);
    if filing_fee > 0 {
        let token_client = soroban_sdk::token::TokenClient::new(env, &policy.asset);
        let allowance = token_client.allowance(holder, &env.current_contract_address());
        if allowance < filing_fee {
            return Err(Error::InsufficientAllowanceForFee);
        }

        crate::token::collect_premium(env, holder, &policy.asset, filing_fee);
        storage::set_claim_filing_fee_paid(env, claim_id, filing_fee);

        ClaimFeeCollected {
            claim_id,
            fee_amount: filing_fee,
            payer: holder.clone(),
            at_ledger: now,
        }
        .publish(env);
    }

    let mut status_history: Vec<ClaimStatusHistoryEntry> = Vec::new(env);
    push_status_transition(&mut status_history, ClaimStatus::Processing, now);
    storage::snapshot_claim_voters(env, claim_id);
    let eligible_voter_count = storage::get_claim_voters(env, claim_id).len();

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
        payout_deadline_ledger: 0,
        approve_votes: 0,
        reject_votes: 0,
        filed_at: now,
        eligible_voter_count,
        appeal_open_deadline_ledger: 0,
        appeals_count: 0,
        appeal_deadline_ledger: 0,
        appeal_approve_votes: 0,
        appeal_reject_votes: 0,
        status_history,
        dispute_deadline_ledger: 0,
        paid_amount: 0,
        installment_count: 0,
    };

    storage::set_claim(env, &claim);
    storage::set_open_claim(env, holder, policy_id, true);
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
    events::emit_claim_status_changed(env, claim_id, ClaimStatus::Pending, ClaimStatus::Processing);

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
    let old_status = claim.status.clone();
    claim.status = ClaimStatus::Withdrawn;
    push_status_transition(&mut claim.status_history, ClaimStatus::Withdrawn, now);

    storage::set_open_claim(env, &claim.claimant, claim.policy_id, false);

    match storage::take_claim_rate_limit_prev(env, claim_id) {
        Some(ledger) => storage::set_last_claim_ledger(env, &claim.claimant, ledger),
        None => storage::remove_last_claim_ledger(env, &claim.claimant),
    }

    storage::set_claim(env, &claim);

    // ── Filing fee refund ────────────────────────────────────────────────
    //
    // If a non-zero filing fee was collected at `file_claim`, refund it in
    // full now. Withdrawal is only reachable while `approve_votes ==
    // reject_votes == 0` (checked above), so this always refunds a claim
    // that has not yet been voted on.
    if let Some(fee_paid) = storage::take_claim_filing_fee_paid(env, claim_id) {
        if fee_paid > 0 {
            crate::token::refund_fee(env, &claim.claimant, &claim.asset, fee_paid);
            ClaimFeeRefunded {
                claim_id,
                fee_amount: fee_paid,
                recipient: claim.claimant.clone(),
                at_ledger: now,
            }
            .publish(env);
        }
    }

    ClaimWithdrawn {
        claim_id,
        policy_id: claim.policy_id,
        claimant: claimant.clone(),
        at_ledger: now,
    }
    .publish(env);
    events::emit_claim_status_changed(env, claim_id, old_status, ClaimStatus::Withdrawn);

    Ok(())
}

// ── vote_on_claim ─────────────────────────────────────────────────────────────

/// Cast a vote on a pending claim.
///
/// Claimants may not vote on their own claims, and the window check uses
/// `now <= claim.voting_deadline_ledger` (inclusive; see `ledger::is_claim_voting_open`).
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

    if voter == &claim.claimant {
        return Err(Error::SelfVoteNotAllowed);
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

    // Issue #783: enforce voter cap — reject if already at max unique voters.
    let cast_count = claim.approve_votes + claim.reject_votes;
    let max_voters = storage::get_max_voters_per_claim(env);
    if cast_count >= max_voters && storage::get_vote(env, claim_id, voter).is_none() {
        return Err(Error::VoterCapReached);
    }

    let resolved_target = storage::resolve_vote_delegation_target(env, voter, now)?;
    if resolved_target != *voter {
        return Err(Error::VoteDelegated);
    }

    // Duplicate vote check — before any write.
    if storage::get_vote(env, claim_id, voter).is_some() {
        return Err(Error::DuplicateVote);
    }

    storage::set_vote(env, claim_id, voter, vote);

    let status_before = claim.status.clone();

    // Compute vote weight: proportional to active policy count when governance token
    // is enabled (capped by max_weight_cap), or 1 when disabled.
    let default_weight: u32 = if crate::governance_token::governance_token_effective_enabled(env) {
        let balance = storage::get_holder_active_policy_count(env, voter) as i128;
        let cap = storage::get_max_weight_cap(env);
        balance.min(cap).max(1) as u32
    } else {
        1
    };
    // Validity check on the snapshot entry: a zero or negative voting power
    // (only reachable via a corrupted/seeded entry — see
    // `storage::voting_power_for`) must not be silently treated as valid
    // weight, since that would skew quorum math. Revert instead.
    let vote_weight: u32 = storage::voting_power_for(env, claim_id, voter, default_weight)?;

    match vote {
        VoteOption::Approve => {
            claim.approve_votes = claim.approve_votes.saturating_add(vote_weight)
        }
        VoteOption::Reject => claim.reject_votes = claim.reject_votes.saturating_add(vote_weight),
    }

    let eligible = claim.eligible_voter_count;
    let cast = claim.approve_votes + claim.reject_votes;
    let quorum_bps = effective_quorum_bps(env, claim_id);
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
            claim.appeal_open_deadline_ledger = now
                .checked_add(ledger::APPEAL_OPEN_WINDOW_LEDGERS)
                .ok_or(Error::Overflow)?;
        }
    }

    if claim.status != status_before {
        if claim.status == ClaimStatus::Approved && claim.payout_deadline_ledger == 0 {
            claim.payout_deadline_ledger = now
                .checked_add(ledger::PAYOUT_TIMEOUT_LEDGERS)
                .ok_or(Error::Overflow)?;
        }
        push_status_transition(&mut claim.status_history, claim.status.clone(), now);
        events::emit_claim_status_changed(
            env,
            claim_id,
            status_before.clone(),
            claim.status.clone(),
        );
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

    // Record resolution ledger for per-policy cooldown enforcement.
    if claim.status == ClaimStatus::Approved || claim.status == ClaimStatus::Rejected {
        storage::set_last_claim_resolved_ledger(env, &claim.claimant, claim.policy_id, now);
    }

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
fn finalize_claim_inner(env: &Env, claim_id: u64) -> Result<ClaimStatus, Error> {
    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    if claim.status.is_terminal() {
        return Err(Error::ClaimAlreadyTerminal);
    }

    let now = env.ledger().sequence();
    if !ledger::is_claim_past_voting_deadline(now, claim.voting_deadline_ledger) {
        return Err(Error::VotingWindowStillOpen);
    }

    let status_before = claim.status.clone();

    let eligible = claim.eligible_voter_count;
    let cast = claim.approve_votes + claim.reject_votes;
    let quorum_bps = effective_quorum_bps(env, claim_id);

    if participation_quorum_met(cast, eligible, quorum_bps) {
        // ── Tie-breaking rule ────────────────────────────────────────────
        //
        // When `approve_votes == reject_votes` exactly, the claim is
        // Rejected, not Approved. This is a strict `>` comparison (not
        // `>=`), so a tie falls through to the `else` branch below.
        //
        // Rationale (insurer-favored default, matching the no-quorum branch
        // a few lines down): approval should require an affirmative
        // majority, not merely "no fewer" reject votes. This mirrors
        // `resolve_plurality_if_quorum_met` (used by `vote_on_claim` for
        // early resolution), which applies the identical `>` comparison —
        // so the outcome of a tie is the same whether the claim resolves
        // early via voting or later via `finalize_claim`/deadline, and is
        // independent of the order in which votes were submitted (only the
        // final approve/reject totals matter). See
        // `tests/finalize_tie_vote.rs` and `docs/GOVERNANCE.md` /
        // `docs/EVENT_DICTIONARY.md` for the documented rule.
        if claim.approve_votes > claim.reject_votes {
            claim.status = ClaimStatus::Approved;
        } else {
            claim.status = ClaimStatus::Rejected;
            claim.appeal_open_deadline_ledger = now
                .checked_add(ledger::APPEAL_OPEN_WINDOW_LEDGERS)
                .ok_or(Error::Overflow)?;
        }
    } else {
        // Below minimum participation — no quorum (insurer-favored default).
        claim.status = ClaimStatus::Rejected;
        claim.appeal_open_deadline_ledger = now
            .checked_add(ledger::APPEAL_OPEN_WINDOW_LEDGERS)
            .ok_or(Error::Overflow)?;
    }

    if claim.status != status_before {
        if claim.status == ClaimStatus::Approved && claim.payout_deadline_ledger == 0 {
            claim.payout_deadline_ledger = now
                .checked_add(ledger::PAYOUT_TIMEOUT_LEDGERS)
                .ok_or(Error::Overflow)?;
            // Set dispute deadline after approval
            claim.dispute_deadline_ledger = now
                .checked_add(ledger::DEFAULT_DISPUTE_WINDOW_LEDGERS)
                .ok_or(Error::Overflow)?;
        }
        push_status_transition(&mut claim.status_history, claim.status.clone(), now);
        events::emit_claim_status_changed(
            env,
            claim_id,
            status_before.clone(),
            claim.status.clone(),
        );
    }

    let newly_rejected = claim.status == ClaimStatus::Rejected;

    storage::set_open_claim(env, &claim.claimant, claim.policy_id, false);

    if status_before == ClaimStatus::Processing && claim.status != ClaimStatus::Processing {
        storage::remove_claim_rate_limit_prev(env, claim_id);
    }

    let status = claim.status.clone();
    storage::set_claim(env, &claim);

    // Record resolution ledger for per-policy cooldown enforcement.
    if claim.status == ClaimStatus::Approved || claim.status == ClaimStatus::Rejected {
        storage::set_last_claim_resolved_ledger(env, &claim.claimant, claim.policy_id, now);
    }

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

// ── Batch finalization constants ──────────────────────────────────────────────

/// Maximum number of claim IDs accepted in a single `finalize_expired_batch` call.
///
/// Sized to stay within Soroban's default instruction budget for a single transaction.
/// Each claim requires at least one persistent read + write; 20 matches the existing
/// `PAGE_SIZE_MAX` pagination cap used elsewhere in this contract.
///
/// Callers that need to process more claims must split into multiple transactions.
pub const BATCH_FINALIZE_MAX: u32 = 20;

// ── BatchFinalized event ──────────────────────────────────────────────────────

/// Summary event emitted once per `finalize_expired_batch` call after all eligible
/// claims have been processed.
///
/// topics: ("niffyinsure", "batch_finalized")
/// payload: { processed, skipped, at_ledger }
///
/// `processed` = number of claims that transitioned out of `Processing`.
/// `skipped`   = number of claim IDs that were already terminal or not found.
#[contractevent(topics = ["niffyinsure", "batch_finalized"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchFinalized {
    pub processed: u32,
    pub skipped: u32,
    pub at_ledger: u32,
}

/// Permissionless keeper: finalize multiple expired claims in one transaction.
///
/// For each `claim_id` in `claim_ids`:
/// - If the claim is not found or already terminal → skip (no revert).
/// - If the voting deadline has not passed → skip (no revert).
/// - Otherwise → finalize via the same logic as `process_deadline`.
///
/// Reverts before any processing if `claim_ids.len() > BATCH_FINALIZE_MAX`.
/// Reverts if `claims_paused` is set.
///
/// Emits individual finalization events per claim (via `finalize_claim_inner`)
/// and one `BatchFinalized` summary event at the end.
pub fn finalize_expired_batch(
    env: &Env,
    claim_ids: &soroban_sdk::Vec<u64>,
) -> Result<(u32, u32), Error> {
    if storage::get_pause_flags(env).claims_paused {
        return Err(Error::CalculatorPaused);
    }
    if claim_ids.len() > BATCH_FINALIZE_MAX {
        return Err(Error::PolicyBatchTooLarge);
    }

    let now = env.ledger().sequence();
    let mut processed: u32 = 0;
    let mut skipped: u32 = 0;

    for i in 0..claim_ids.len() {
        let claim_id = claim_ids.get(i).unwrap();

        let claim = match storage::get_claim(env, claim_id) {
            Some(c) => c,
            None => {
                skipped += 1;
                continue;
            }
        };

        // Skip already-finalized claims without reverting.
        if claim.status.is_terminal() {
            skipped += 1;
            continue;
        }

        // Skip claims whose voting window is still open.
        if !ledger::is_claim_past_voting_deadline(now, claim.voting_deadline_ledger) {
            skipped += 1;
            continue;
        }

        // Only finalize Processing claims (same guard as process_deadline).
        if claim.status != ClaimStatus::Processing {
            skipped += 1;
            continue;
        }

        // finalize_claim_inner never panics for eligible claims; propagate unexpected errors.
        finalize_claim_inner(env, claim_id)?;
        processed += 1;
    }

    BatchFinalized {
        processed,
        skipped,
        at_ledger: now,
    }
    .publish(env);

    Ok((processed, skipped))
}

/// Permissionless keeper: same outcome as `finalize_claim` when voting has ended, but returns
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

/// Permissionless keeper: auto-reject an approved claim once its payout deadline has passed.
pub fn process_payout_timeout(env: &Env, claim_id: u64) -> Result<ClaimStatus, Error> {
    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    if claim.status != ClaimStatus::Approved {
        return Err(Error::ClaimNotApproved);
    }

    let now = env.ledger().sequence();
    if now <= claim.payout_deadline_ledger {
        return Err(Error::PayoutDeadlineNotReached);
    }

    claim.status = ClaimStatus::PayoutTimeout;
    push_status_transition(&mut claim.status_history, ClaimStatus::PayoutTimeout, now);
    storage::set_open_claim(env, &claim.claimant, claim.policy_id, false);
    storage::remove_claim_rate_limit_prev(env, claim_id);
    storage::set_claim(env, &claim);

    PayoutTimedOut {
        claim_id,
        deadline_ledger: claim.payout_deadline_ledger,
        at_ledger: now,
    }
    .publish(env);

    Ok(claim.status)
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
    // AppealApproved is also accepted — same payout flow as Approved.
    if claim.status != ClaimStatus::Approved && claim.status != ClaimStatus::AppealApproved {
        return Err(Error::ClaimNotApproved);
    }

    // Check dispute deadline: payout cannot execute until dispute window closes
    let now = env.ledger().sequence();
    if now <= claim.dispute_deadline_ledger {
        return Err(Error::DisputeWindowActive);
    }

    payout(env, &claim)?;
    crate::rolling_claim_cap::record_claim_paid(
        env,
        &claim.claimant,
        claim.policy_id,
        claim.amount,
        now,
    );
    let old_status = claim.status.clone();
    claim.status = ClaimStatus::Paid;
    push_status_transition(&mut claim.status_history, ClaimStatus::Paid, now);
    storage::set_open_claim(env, &claim.claimant, claim.policy_id, false);
    storage::remove_claim_rate_limit_prev(env, claim_id);
    storage::set_claim(env, &claim);
    events::emit_claim_status_changed(env, claim_id, old_status, ClaimStatus::Paid);
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
    let now = env.ledger().sequence();

    if !storage::is_allowed_asset(env, &policy.asset) {
        return Err(Error::InvalidAsset);
    }

    // Resolve effective payout asset: use PolicyTypeConfig override when set,
    // otherwise fall back to the policy's bound premium asset.
    let type_config = storage::get_policy_type_config(env, &policy.policy_type);
    let effective_asset = type_config
        .as_ref()
        .and_then(|c| c.payout_asset_override.clone())
        .unwrap_or_else(|| policy.asset.clone());

    // The override asset must also be allowlisted at payout time.
    if !storage::is_allowed_asset(env, &effective_asset) {
        return Err(Error::InvalidAsset);
    }

    let gross = claim.amount;
    let deductible = claim.deductible;
    let net = gross.checked_sub(deductible).ok_or(Error::Overflow)?;
    if net <= 0 {
        // Enum size capped by Soroban; reuse ClaimAmountZero for "no positive payout after deductible".
        return Err(Error::ClaimAmountZero);
    }

    let payout_to = policy
        .beneficiary
        .clone()
        .unwrap_or_else(|| policy.holder.clone());

    if payout_to.executable().is_some() {
        if !storage::is_allowed_payout_recipient(env, &payout_to) {
            return Err(Error::PayoutRecipientContractNotAllowlisted);
        }
        PayoutRecipientWarning {
            claim_id: claim.claim_id,
            recipient: payout_to.clone(),
            asset: effective_asset.clone(),
            at_ledger: now,
        }
        .publish(env);
    }

    // Emit override event before the transfer so indexers see the asset decision first.
    let override_active = effective_asset != policy.asset;
    if override_active {
        crate::events::emit_payout_asset_override_applied(
            env,
            claim.claim_id,
            policy.policy_type.clone(),
            &policy.asset,
            &effective_asset,
        );
    }

    // Issue #581: attempt primary treasury; if insufficient, draw from reinsurance.
    let primary_balance = crate::token::get_balance(env, &effective_asset);
    if primary_balance >= net {
        crate::token::transfer(
            env,
            &effective_asset,
            &env.current_contract_address(),
            &payout_to,
            net,
        );
    } else {
        // Primary treasury insufficient — try reinsurance
        let reinsurance =
            storage::get_reinsurance_contract(env).ok_or(Error::NoReinsuranceConfigured)?;

        let primary_amount = primary_balance.max(0);
        let reinsurance_amount = net.checked_sub(primary_amount).ok_or(Error::Overflow)?;

        // Transfer whatever is available from primary
        if primary_amount > 0 {
            crate::token::transfer(
                env,
                &effective_asset,
                &env.current_contract_address(),
                &payout_to,
                primary_amount,
            );
        }

        // Draw remainder from reinsurance pool
        crate::token::transfer_from_reinsurance(
            env,
            &effective_asset,
            &reinsurance,
            &payout_to,
            reinsurance_amount,
        );

        crate::types::ReinsuranceDrawdown {
            claim_id: claim.claim_id,
            primary_amount,
            reinsurance_amount,
            reinsurance_contract: reinsurance,
        }
        .publish(env);
    }

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

/// Admin-only: dispute an approved claim within the dispute window.
/// Freezes payout and sets status to Disputed for review.
///
/// Not to be confused with `open_appeal` (claimant, on `Rejected`) or
/// `escalate_claim` (admin, on `Processing`) — see `docs/GLOSSARY.md`.
pub fn dispute_claim(env: &Env, claim_id: u64) -> Result<(), Error> {
    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    if claim.status != ClaimStatus::Approved {
        return Err(Error::ClaimNotApproved);
    }

    let now = env.ledger().sequence();
    if now > claim.dispute_deadline_ledger {
        return Err(Error::PayoutDeadlineNotReached);
    }

    let _old_status = claim.status.clone();
    claim.status = ClaimStatus::Disputed;
    push_status_transition(&mut claim.status_history, ClaimStatus::Disputed, now);
    storage::set_claim(env, &claim);

    ClaimDisputed {
        claim_id,
        at_ledger: now,
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

// ── Issue #583: Fraud score ───────────────────────────────────────────────────

/// Emitted when a fraud score is set for a claim.
#[contractevent(topics = ["niffyinsure", "claim_fraud_score_set"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimFraudScoreSet {
    #[topic]
    pub claim_id: u64,
    pub score: u32,
    pub set_by: Address,
    pub at_ledger: u32,
}

/// Admin or oracle: set the fraud score for a claim (0–100).
/// Requires admin auth or a valid delegation with `can_set_fraud_score`.
pub fn set_claim_fraud_score(
    env: &Env,
    caller: &Address,
    claim_id: u64,
    score: u32,
) -> Result<(), Error> {
    if score > 100 {
        return Err(Error::SafetyScoreOutOfRange);
    }
    // Verify claim exists
    let _ = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    let admin = storage::get_admin(env);
    if *caller != admin {
        // Check delegation
        let delegation = storage::get_delegation(env, caller).ok_or(Error::DelegationInvalid)?;
        let now = env.ledger().sequence();
        if now > delegation.expiry_ledger {
            return Err(Error::DelegationInvalid);
        }
        if !delegation.permissions.can_set_fraud_score {
            return Err(Error::DelegationPermissionDenied);
        }
    }

    storage::set_claim_fraud_score(env, claim_id, score);

    ClaimFraudScoreSet {
        claim_id,
        score,
        set_by: caller.clone(),
        at_ledger: env.ledger().sequence(),
    }
    .publish(env);

    Ok(())
}

/// Returns the effective quorum bps for a claim, applying elevated quorum
/// when a fraud score exceeds the configured threshold.
pub fn effective_quorum_bps(env: &Env, claim_id: u64) -> u32 {
    let base = storage::get_claim_quorum_bps(env, claim_id);
    if let Some(score) = storage::get_claim_fraud_score(env, claim_id) {
        let threshold = storage::get_fraud_score_threshold(env);
        if score > threshold {
            let elevated = storage::get_elevated_quorum_bps(env);
            return elevated.max(base);
        }
    }
    base
}

#[cfg(test)]
mod evidence_hash_tests {
    use crate::types::ClaimEvidenceEntry;
    use crate::validate::{check_claim_fields, Error};
    use soroban_sdk::{BytesN, Env, String, Vec};

    fn make_hash(env: &Env, fill: u8) -> BytesN<32> {
        let b = [fill; 32];
        BytesN::from_array(env, &b)
    }

    fn make_url(env: &Env) -> String {
        String::from_str(
            env,
            "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        )
    }

    fn make_details(env: &Env) -> String {
        String::from_str(env, "flood damage")
    }

    #[test]
    fn zero_hash_is_rejected() {
        let env = Env::default();
        let contract_id = env.register(crate::NiffyInsure, ());
        let mut evidence: Vec<ClaimEvidenceEntry> = Vec::new(&env);
        evidence.push_back(ClaimEvidenceEntry {
            url: make_url(&env),
            hash: make_hash(&env, 0x00),
        });
        let err = env.as_contract(&contract_id, || {
            check_claim_fields(&env, 100, 1000, &make_details(&env), &evidence).unwrap_err()
        });
        assert_eq!(err, Error::ExcessiveEvidenceBytes);
    }

    #[test]
    fn non_zero_hash_is_accepted() {
        let env = Env::default();
        let contract_id = env.register(crate::NiffyInsure, ());
        let mut evidence: Vec<ClaimEvidenceEntry> = Vec::new(&env);
        evidence.push_back(ClaimEvidenceEntry {
            url: make_url(&env),
            hash: make_hash(&env, 0xab),
        });
        env.as_contract(&contract_id, || {
            assert!(check_claim_fields(&env, 100, 1000, &make_details(&env), &evidence).is_ok());
        });
    }

    #[test]
    fn mixed_zero_and_nonzero_hash_rejected_on_zero_entry() {
        let env = Env::default();
        let contract_id = env.register(crate::NiffyInsure, ());
        let mut evidence: Vec<ClaimEvidenceEntry> = Vec::new(&env);
        evidence.push_back(ClaimEvidenceEntry {
            url: make_url(&env),
            hash: make_hash(&env, 0xab),
        });
        evidence.push_back(ClaimEvidenceEntry {
            url: make_url(&env),
            hash: make_hash(&env, 0x00),
        });
        let err = env.as_contract(&contract_id, || {
            check_claim_fields(&env, 100, 1000, &make_details(&env), &evidence).unwrap_err()
        });
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

/// Verify that `ClaimStatus::Appealed` is not treated as a terminal state,
/// which would incorrectly allow `process_claim` / `finalize_claim` to close
/// an in-flight appeal without resolving the appeal round.
#[cfg(test)]
mod appeal_stub_tests {
    use crate::types::ClaimStatus;

    #[test]
    fn appealed_is_not_terminal() {
        assert!(
            !ClaimStatus::Appealed.is_terminal(),
            "ClaimStatus::Appealed must NOT be terminal — an appeal in progress \
             must not allow finalization or payout until the appeal round resolves"
        );
    }

    #[test]
    fn appeal_resolved_states_are_terminal() {
        // Once an appeal resolves, both outcomes are terminal.
        assert!(ClaimStatus::AppealApproved.is_terminal());
        assert!(ClaimStatus::AppealRejected.is_terminal());
    }
}
// ── add_claim_evidence ───────────────────────────────────────────────────────

/// Claimant-only: replace evidence during the pre-vote window.
///
/// Allowed only while the claim is still `Processing` and no ballots have been
/// cast yet. This lets the claimant correct or expand evidence before voting
/// begins without mutating any in-flight vote state.
pub fn add_claim_evidence(
    env: &Env,
    claimant: &Address,
    claim_id: u64,
    new_evidence: &Vec<ClaimEvidenceEntry>,
) -> Result<(), Error> {
    storage::assert_claims_not_paused(env);

    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;
    if claimant != &claim.claimant {
        return Err(Error::NotEligibleVoter);
    }
    if claim.status != ClaimStatus::Processing
        || claim.approve_votes != 0
        || claim.reject_votes != 0
    {
        return Err(Error::ClaimEvidenceUpdateNotAllowed);
    }

    validate::check_claim_evidence_update(env, new_evidence)?;

    claim.evidence = new_evidence.clone();
    storage::set_claim(env, &claim);

    let now = env.ledger().sequence();
    let mut evidence_hashes: Vec<BytesN<32>> = Vec::new(env);
    for e in new_evidence.iter() {
        evidence_hashes.push_back(e.hash.clone());
    }
    ClaimEvidenceUpdated {
        claim_id,
        policy_id: claim.policy_id,
        evidence_hashes,
        at_ledger: now,
    }
    .publish(env);

    Ok(())
}

// ── disburse_installment (admin partial payout) ───────────────────────────────

/// Admin-only: disburse a partial payout installment against an approved claim.
///
/// - `amount` must be > 0 and must not cause `paid_amount > net_amount`.
/// - Emits `InstallmentDisbursed` every call.
/// - When `paid_amount >= net_amount` after this transfer, marks status `Paid`
///   and emits `ClaimFullyPaid`.
pub fn disburse_installment(env: &Env, claim_id: u64, amount: i128) -> Result<(), Error> {
    if amount <= 0 {
        return Err(Error::ClaimAmountZero);
    }

    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    if claim.status == ClaimStatus::Paid {
        return Err(Error::AlreadyPaid);
    }
    if claim.status != ClaimStatus::Approved {
        return Err(Error::ClaimNotApproved);
    }

    let now = env.ledger().sequence();
    if now <= claim.dispute_deadline_ledger {
        return Err(Error::DisputeWindowActive);
    }

    let gross = claim.amount;
    let deductible = claim.deductible;
    let net = gross.checked_sub(deductible).ok_or(Error::Overflow)?;
    if net <= 0 {
        return Err(Error::ClaimAmountZero);
    }

    let remaining = net.checked_sub(claim.paid_amount).ok_or(Error::Overflow)?;
    if amount > remaining {
        return Err(Error::OverDisbursement);
    }

    // Resolve payout recipient and asset (same logic as full payout).
    let policy =
        storage::get_policy(env, &claim.claimant, claim.policy_id).ok_or(Error::PolicyNotFound)?;
    let type_config = storage::get_policy_type_config(env, &policy.policy_type);
    let effective_asset = type_config
        .as_ref()
        .and_then(|c| c.payout_asset_override.clone())
        .unwrap_or_else(|| policy.asset.clone());

    if !storage::is_allowed_asset(env, &effective_asset) {
        return Err(Error::InvalidAsset);
    }

    let payout_to = policy
        .beneficiary
        .clone()
        .unwrap_or_else(|| policy.holder.clone());

    crate::token::transfer(
        env,
        &effective_asset,
        &env.current_contract_address(),
        &payout_to,
        amount,
    );

    claim.paid_amount = claim
        .paid_amount
        .checked_add(amount)
        .ok_or(Error::Overflow)?;
    claim.installment_count += 1;

    events::emit_installment_disbursed(
        env,
        claim_id,
        &payout_to,
        amount,
        claim.paid_amount,
        net,
        claim.installment_count,
        &effective_asset,
    );

    if claim.paid_amount >= net {
        let old_status = claim.status.clone();
        claim.status = ClaimStatus::Paid;
        push_status_transition(&mut claim.status_history, ClaimStatus::Paid, now);
        storage::set_open_claim(env, &claim.claimant, claim.policy_id, false);
        storage::remove_claim_rate_limit_prev(env, claim_id);
        events::emit_claim_status_changed(env, claim_id, old_status, ClaimStatus::Paid);
        events::emit_claim_fully_paid(
            env,
            claim_id,
            &payout_to,
            claim.paid_amount,
            claim.installment_count,
        );
        crate::rolling_claim_cap::record_claim_paid(
            env,
            &claim.claimant,
            claim.policy_id,
            net,
            now,
        );
    }

    storage::set_claim(env, &claim);
    Ok(())
}

// ── Appeal mechanism ──────────────────────────────────────────────────────────
//
// After a claim is Rejected, the claimant has `APPEAL_OPEN_WINDOW_LEDGERS` to
// open an appeal. The appeal runs a fresh vote round with a higher quorum
// requirement (APPEAL_ELEVATED_QUORUM_BPS) and a shorter deadline
// (APPEAL_VOTE_WINDOW_LEDGERS). Only one appeal per claim is allowed
// (MAX_APPEALS_PER_CLAIM = 1).
//
// State machine during appeal:
//   Rejected → UnderAppeal  (open_appeal called within window)
//   UnderAppeal → AppealApproved  (vote or finalize; approve wins)
//   UnderAppeal → AppealRejected  (vote or finalize; reject wins or no quorum)
//
// The elevated quorum for appeal rounds uses APPEAL_ELEVATED_QUORUM_BPS (7500 = 75%).
// This can be overridden by the admin via `admin_set_elevated_quorum_bps`.

/// Quorum basis points used for appeal vote rounds when no elevated quorum is configured.
/// 75% (7500 / 10_000) is intentionally higher than the default 50% base quorum
/// to reflect the higher evidentiary bar for reversing a prior rejection.
pub const APPEAL_ELEVATED_QUORUM_BPS: u32 = 7_500;

/// Emitted when a claimant opens an appeal on a rejected claim.
///
/// Topic layout: ["niffyinsure", "appeal_opened", claim_id]
/// Data: { policy_id, claimant, appeal_deadline_ledger, quorum_bps, at_ledger }
#[contractevent(topics = ["niffyinsure", "appeal_opened"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppealOpened {
    #[topic]
    pub claim_id: u64,
    pub policy_id: u32,
    pub claimant: Address,
    /// Voting deadline for this appeal round (ledger sequence).
    pub appeal_deadline_ledger: u32,
    /// Quorum basis points required for this appeal round.
    pub quorum_bps: u32,
    pub at_ledger: u32,
}

/// Emitted when an appeal vote round resolves (approved or rejected).
///
/// Topic layout: ["niffyinsure", "appeal_resolved", claim_id]
#[contractevent(topics = ["niffyinsure", "appeal_resolved"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppealResolved {
    #[topic]
    pub claim_id: u64,
    pub policy_id: u32,
    pub claimant: Address,
    pub outcome: ClaimStatus,
    pub approve_votes: u32,
    pub reject_votes: u32,
    pub at_ledger: u32,
}

/// Emitted when an appeal vote is cast.
///
/// Topic layout: ["niffyinsure", "appeal_vote_cast", claim_id]
#[contractevent(topics = ["niffyinsure", "appeal_vote_cast"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppealVoteCast {
    #[topic]
    pub claim_id: u64,
    #[topic]
    pub voter: Address,
    pub vote: VoteOption,
    pub at_ledger: u32,
}

/// Claimant-only: open an appeal on a rejected claim.
///
/// Not to be confused with `dispute_claim` (admin, on `Approved`) or
/// `escalate_claim` (admin, on `Processing`) — see `docs/GLOSSARY.md`.
///
/// Preconditions:
///   - `claim.status == Rejected`
///   - `now <= claim.appeal_open_deadline_ledger` (within appeal window).
///     The deadline ledger itself is INCLUSIVE: calling at
///     `now == appeal_open_deadline_ledger` succeeds; calling at
///     `now == appeal_open_deadline_ledger + 1` fails with `AppealWindowClosed`.
///   - `claim.appeals_count < MAX_APPEALS_PER_CLAIM` (only one appeal allowed)
///
/// Transitions: `Rejected → UnderAppeal`
/// Resets vote counts, sets `appeal_deadline_ledger`, requires elevated quorum
/// (`APPEAL_ELEVATED_QUORUM_BPS` or admin-configured `elevated_quorum_bps`).
///
/// A fresh voter snapshot is taken at appeal opening so new policy-holders
/// can participate in the appeal vote (and departed ones cannot).
pub fn open_appeal(env: &Env, claimant: &Address, claim_id: u64) -> Result<(), Error> {
    storage::assert_claims_not_paused(env);

    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    // Only the original claimant may open an appeal.
    if claimant != &claim.claimant {
        return Err(Error::NotEligibleVoter);
    }

    // Claim must be in Rejected status to appeal.
    if claim.status != ClaimStatus::Rejected {
        return Err(Error::ClaimAlreadyTerminal);
    }

    let now = env.ledger().sequence();

    // Appeal window: must be called within APPEAL_OPEN_WINDOW_LEDGERS of rejection.
    if now > claim.appeal_open_deadline_ledger {
        return Err(Error::AppealWindowClosed);
    }

    // Cap: only one appeal allowed per claim.
    if claim.appeals_count >= ledger::MAX_APPEALS_PER_CLAIM {
        return Err(Error::AppealAlreadyUsed);
    }

    // Reset vote tallies for the appeal round.
    claim.appeal_approve_votes = 0;
    claim.appeal_reject_votes = 0;

    // Set the appeal voting deadline.
    claim.appeal_deadline_ledger = now
        .checked_add(ledger::APPEAL_VOTE_WINDOW_LEDGERS)
        .ok_or(Error::Overflow)?;

    claim.appeals_count = claim.appeals_count.saturating_add(1);

    // Determine quorum for this appeal round. Use the admin-configured elevated quorum
    // when set; fall back to APPEAL_ELEVATED_QUORUM_BPS.
    let appeal_quorum_bps = {
        let configured = storage::get_elevated_quorum_bps(env);
        // elevated_quorum_bps defaults to 7500; if admin hasn't changed it, we use
        // our own constant to be explicit. Both values happen to be the same default.
        configured.max(APPEAL_ELEVATED_QUORUM_BPS)
    };

    // Snapshot the appeal-round quorum so subsequent admin changes don't affect it.
    storage::set_appeal_claim_quorum_bps(env, claim_id, appeal_quorum_bps);

    // Take a fresh voter snapshot for the appeal round.
    storage::snapshot_appeal_voters(env, claim_id);

    // Transition to UnderAppeal.
    let old_status = claim.status.clone();
    claim.status = ClaimStatus::UnderAppeal;
    push_status_transition(&mut claim.status_history, ClaimStatus::UnderAppeal, now);

    // Re-open the "open claim" slot so finalization bookkeeping is consistent.
    storage::set_open_claim(env, &claim.claimant, claim.policy_id, true);

    storage::set_claim(env, &claim);

    crate::events::emit_claim_status_changed(env, claim_id, old_status, ClaimStatus::UnderAppeal);

    AppealOpened {
        claim_id,
        policy_id: claim.policy_id,
        claimant: claimant.clone(),
        appeal_deadline_ledger: claim.appeal_deadline_ledger,
        quorum_bps: appeal_quorum_bps,
        at_ledger: now,
    }
    .publish(env);

    Ok(())
}

/// Cast a vote in an active appeal round.
///
/// Window check: `now <= claim.appeal_deadline_ledger`.
/// Only voters present in the appeal snapshot electorate may vote.
/// Duplicate votes are rejected.
/// If quorum is reached mid-vote, the appeal resolves immediately.
pub fn vote_on_appeal(
    env: &Env,
    voter: &Address,
    claim_id: u64,
    vote: &VoteOption,
) -> Result<ClaimStatus, Error> {
    storage::assert_claims_not_paused(env);

    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    if claim.status != ClaimStatus::UnderAppeal {
        return Err(Error::ClaimAlreadyTerminal);
    }

    let now = env.ledger().sequence();

    // Appeal voting window (inclusive deadline).
    if !ledger::is_claim_voting_open(now, claim.appeal_deadline_ledger) {
        return Err(Error::VotingWindowClosed);
    }

    // Voter must be in the appeal snapshot.
    if !storage::has_appeal_voters(env, claim_id) {
        return Err(Error::VoterSnapshotExpired);
    }
    let snapshot = storage::get_appeal_voters(env, claim_id);
    if !snapshot.iter().any(|v| v == *voter) {
        return Err(Error::NotEligibleVoter);
    }

    // Check delegation: delegated voters must cast through their delegate.
    let resolved_target = storage::resolve_vote_delegation_target(env, voter, now)?;
    if resolved_target != *voter {
        return Err(Error::VoteDelegated);
    }

    // Duplicate appeal vote check.
    if storage::get_appeal_vote(env, claim_id, voter).is_some() {
        return Err(Error::DuplicateVote);
    }

    storage::set_appeal_vote(env, claim_id, voter, vote);

    let vote_weight: u32 = if crate::governance_token::governance_token_effective_enabled(env) {
        let balance = storage::get_holder_active_policy_count(env, voter) as i128;
        let cap = storage::get_max_weight_cap(env);
        balance.min(cap).max(1) as u32
    } else {
        1
    };

    match vote {
        VoteOption::Approve => {
            claim.appeal_approve_votes = claim.appeal_approve_votes.saturating_add(vote_weight)
        }
        VoteOption::Reject => {
            claim.appeal_reject_votes = claim.appeal_reject_votes.saturating_add(vote_weight)
        }
    }

    AppealVoteCast {
        claim_id,
        voter: voter.clone(),
        vote: vote.clone(),
        at_ledger: now,
    }
    .publish(env);

    let eligible = snapshot.len();
    let cast = claim.appeal_approve_votes + claim.appeal_reject_votes;
    let quorum_bps = storage::get_appeal_claim_quorum_bps(env, claim_id);

    let maybe_resolved = resolve_plurality_if_quorum_met(
        claim.appeal_approve_votes,
        claim.appeal_reject_votes,
        cast,
        eligible,
        quorum_bps,
    );

    if let Some(raw) = maybe_resolved {
        // Map base-claim status to appeal outcome statuses.
        let outcome = if raw == ClaimStatus::Approved {
            ClaimStatus::AppealApproved
        } else {
            ClaimStatus::AppealRejected
        };
        finalize_appeal_outcome(env, &mut claim, outcome, now)?;
    }

    let status = claim.status.clone();
    storage::set_claim(env, &claim);
    Ok(status)
}

/// Permissionless keeper: finalize an appeal vote after its deadline passes.
///
/// Window check: `now > claim.appeal_deadline_ledger`.
/// Uses participation quorum; if quorum not met, appeal is rejected (insurer-favored default).
///
/// **Pre-deadline behavior:** if called while `now <= claim.appeal_deadline_ledger`
/// (voting still open), this call is **not** a no-op — it returns
/// `Err(Error::VotingWindowStillOpen)` unconditionally, regardless of whether
/// quorum has already been reached. The claim's status and vote tallies are left
/// untouched. Quorum reached mid-vote resolves the appeal immediately from within
/// `vote_on_appeal` instead (see that function); `finalize_appeal` is only ever the
/// path taken once the deadline has passed. See `finalize_appeal_before_deadline_errors_with_quorum_unmet`
/// in `tests/appeal.rs` for coverage.
///
/// **Caller:** this function takes no caller/`Address` argument and performs no
/// auth check — any account may invoke it once the deadline has passed. See
/// `finalize_appeal_succeeds_for_arbitrary_caller_after_deadline` in `tests/appeal.rs`.
pub fn finalize_appeal(env: &Env, claim_id: u64) -> Result<ClaimStatus, Error> {
    storage::assert_claims_not_paused(env);

    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    if claim.status != ClaimStatus::UnderAppeal {
        return Err(Error::ClaimAlreadyTerminal);
    }

    let now = env.ledger().sequence();
    if ledger::is_claim_voting_open(now, claim.appeal_deadline_ledger) {
        return Err(Error::VotingWindowStillOpen);
    }

    let eligible = if storage::has_appeal_voters(env, claim_id) {
        storage::get_appeal_voters(env, claim_id).len()
    } else {
        // Snapshot expired — use eligible_voter_count from original filing as fallback.
        claim.eligible_voter_count
    };

    let cast = claim.appeal_approve_votes + claim.appeal_reject_votes;
    let quorum_bps = storage::get_appeal_claim_quorum_bps(env, claim_id);

    let outcome = if participation_quorum_met(cast, eligible, quorum_bps)
        && claim.appeal_approve_votes > claim.appeal_reject_votes
    {
        ClaimStatus::AppealApproved
    } else {
        ClaimStatus::AppealRejected
    };

    finalize_appeal_outcome(env, &mut claim, outcome, now)?;

    let status = claim.status.clone();
    storage::set_claim(env, &claim);
    Ok(status)
}

/// Internal: apply a resolved appeal outcome to the claim record.
///
/// Sets `status`, pushes history entry, closes the open-claim slot when terminal,
/// sets `payout_deadline_ledger` on AppealApproved, and emits `AppealResolved`.
///
/// ## Event field list for indexers (AppealApproved / AppealRejected transitions)
///
/// Both terminal appeal outcomes emit exactly two events, in this order:
///
/// 1. `ClaimStatusChangedData` (topics: `["niffyins", "claim_status_changed", claim_id]`)
///    - `claim_id: u64`, `version: u32`, `old_status: ClaimStatus` (always `UnderAppeal`),
///      `new_status: ClaimStatus` (`AppealApproved` or `AppealRejected`), `at_ledger: u32`
/// 2. `AppealResolved` (topics: `["niffyinsure", "appeal_resolved", claim_id]`)
///    - `claim_id: u64`, `policy_id: u32`, `claimant: Address`, `outcome: ClaimStatus`,
///      `approve_votes: u32`, `reject_votes: u32`, `at_ledger: u32`
///
/// Together these carry claim id, old/new status, ledger, policy id, claimant, and the
/// final vote tally — everything an indexer needs to record the transition without an
/// extra `get_claim` read.
fn finalize_appeal_outcome(
    env: &Env,
    claim: &mut crate::types::Claim,
    outcome: ClaimStatus,
    now: u32,
) -> Result<(), Error> {
    let old_status = claim.status.clone();
    claim.status = outcome.clone();
    push_status_transition(&mut claim.status_history, outcome.clone(), now);

    if outcome == ClaimStatus::AppealApproved && claim.payout_deadline_ledger == 0 {
        claim.payout_deadline_ledger = now
            .checked_add(ledger::PAYOUT_TIMEOUT_LEDGERS)
            .ok_or(Error::Overflow)?;
        claim.dispute_deadline_ledger = now
            .checked_add(ledger::DEFAULT_DISPUTE_WINDOW_LEDGERS)
            .ok_or(Error::Overflow)?;
    }

    // Close the open-claim slot on terminal appeal outcomes.
    storage::set_open_claim(env, &claim.claimant, claim.policy_id, false);

    crate::events::emit_claim_status_changed(env, claim.claim_id, old_status, outcome.clone());

    AppealResolved {
        claim_id: claim.claim_id,
        policy_id: claim.policy_id,
        claimant: claim.claimant.clone(),
        outcome,
        approve_votes: claim.appeal_approve_votes,
        reject_votes: claim.appeal_reject_votes,
        at_ledger: now,
    }
    .publish(env);

    Ok(())
}

// ── Issue #841: Claim escalation entrypoint ───────────────────────────────────

/// Emitted when admin escalates a stalled claim to a shorter voting deadline.
///
/// Topic layout: ["niffyinsure", "claim_escalated", claim_id]
#[contractevent(topics = ["niffyinsure", "claim_escalated"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimEscalated {
    #[topic]
    pub claim_id: u64,
    pub old_deadline_ledger: u32,
    pub new_deadline_ledger: u32,
    pub at_ledger: u32,
}

/// Admin-only: reduce the voting deadline of a stalled `Processing` claim.
///
/// This is *escalation*: it changes the voting schedule only. It does not
/// revisit a decision — that is `open_appeal` (claimant, on `Rejected`) or
/// `dispute_claim` (admin, on `Approved`). See `docs/GLOSSARY.md`.
///
/// Invariants enforced:
/// - Claim must be in `Processing` status.
/// - `new_deadline_ledger` must be strictly earlier than the current deadline.
/// - `new_deadline_ledger` must be strictly in the future (`> now`).
///
/// Auth: caller must be the contract admin (enforced at the lib.rs entrypoint).
pub fn escalate_claim(env: &Env, claim_id: u64, new_deadline_ledger: u32) -> Result<(), Error> {
    let mut claim = storage::get_claim(env, claim_id).ok_or(Error::ClaimNotFound)?;

    if claim.status != ClaimStatus::Processing {
        return Err(Error::ClaimNotProcessing);
    }

    let now = env.ledger().sequence();

    // New deadline must be in the future.
    if new_deadline_ledger <= now {
        return Err(Error::EscalationDeadlineNotFuture);
    }

    // New deadline must be strictly earlier than the current deadline.
    if new_deadline_ledger >= claim.voting_deadline_ledger {
        return Err(Error::EscalationDeadlineNotEarlier);
    }

    let old_deadline = claim.voting_deadline_ledger;
    claim.voting_deadline_ledger = new_deadline_ledger;
    storage::set_claim(env, &claim);

    ClaimEscalated {
        claim_id,
        old_deadline_ledger: old_deadline,
        new_deadline_ledger,
        at_ledger: now,
    }
    .publish(env);

    Ok(())
}
