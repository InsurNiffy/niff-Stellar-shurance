# Claim Voting Governance

## Quorum and plurality

A claim resolves once **participation quorum** is met: `cast_votes /
eligible_voter_count >= quorum_bps` (basis points, snapshotted per-claim at
filing time). Once quorum is met, the outcome is decided by plurality between
`approve_votes` and `reject_votes`.

## Tie-breaking rule

**When `approve_votes == reject_votes` exactly, the claim is Rejected.**

This is enforced with a strict `approve_votes > reject_votes` comparison; a
tie falls through to the `else` (Rejected) branch. The rule is
insurer-favored by design — the same default used when quorum is *not* met
at all — so approval always requires a genuine affirmative majority rather
than merely "no fewer" reject votes.

The identical comparison is used in two code paths so the result is
consistent no matter which one resolves the claim:

- `resolve_plurality_if_quorum_met` — early resolution inside `vote_on_claim`,
  triggered the moment quorum is reached mid-voting.
- `finalize_claim_inner` — resolution after the voting deadline via
  `finalize_claim` / `finalize_expired_batch`.

Because both paths only look at the final `approve_votes` / `reject_votes`
totals (not the sequence of individual ballots), the tie outcome is also
**independent of vote submission order**.

See `contracts/niffyinsure/src/claim.rs` (search "Tie-breaking rule") for the
code-level comment, `docs/EVENT_DICTIONARY.md` (`clm_final` event) for the
indexer-facing note, and
`contracts/niffyinsure/tests/finalize_tie_vote.rs` for the regression test.

## Claim filing fee

An optional flat filing fee (`claim_filing_fee`, instance storage, default
`0`) may be configured by the admin via `admin_set_claim_filing_fee`. When
non-zero, it is deducted from the claimant atomically with `file_claim` and
deposited into the treasury. If the claimant withdraws the claim via
`withdraw_claim` before any vote is cast, the fee is refunded to them in
full. See `contracts/niffyinsure/tests/claim_filing_fee.rs`.

## Duplicate active coverage

`initiate_policy` rejects a new policy with `DuplicateCoverageActive` when
the holder already has an **active** policy with the same `policy_type`
(asset type) and `region`, whose ledger window `[start_ledger, end_ledger)`
overlaps the new policy's window. See the "Overlapping active coverage
check" comment in `contracts/niffyinsure/src/policy.rs::initiate_policy` and
`contracts/niffyinsure/tests/duplicate_coverage_active.rs`.

## Corrupt voter snapshot entries

`vote_on_claim` validates that the voting power resolved for the caller is
strictly positive before tallying. A zero or negative snapshot entry (only
reachable through corrupted data — see `storage::voting_power_for`) reverts
with `Error::CorruptSnapshotEntry` instead of being silently treated as zero
weight, which would otherwise distort quorum math. See
`contracts/niffyinsure/tests/corrupt_snapshot_entry.rs`.
