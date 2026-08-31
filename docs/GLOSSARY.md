# Glossary

Domain terms that are easy to conflate. One place to look them up.

## Appeal vs. dispute vs. escalation

The contract has three related-but-distinct mechanisms for revisiting a claim.
They differ in **who triggers them** and **what status the claim must be in**,
and no two of them can ever apply to the same claim at the same time.

| Term | Entrypoint | Triggering actor | Status precondition | Effect |
|---|---|---|---|---|
| **Appeal** | `open_appeal` | Claimant (the original filer only) | `Rejected`, and within `appeal_open_deadline_ledger`, and `appeals_count < MAX_APPEALS_PER_CLAIM` (one appeal per claim) | Contests a rejection. `Rejected → UnderAppeal`. Resets vote tallies, takes a **fresh** voter snapshot, and requires an elevated quorum. Resolves to `AppealApproved` or `AppealRejected`. |
| **Dispute** | `admin_dispute_claim` → `dispute_claim` | Contract admin | `Approved`, and within `dispute_deadline_ledger` | Freezes a payout that has been approved but not yet disbursed, pending off-chain review. `Approved → Disputed`. |
| **Escalation** | `escalate_claim` | Contract admin | `Processing` (voting still open) | Does **not** change the outcome or the status. Shortens the voting deadline of a stalled claim so a low-turnout vote can conclude sooner. The new deadline must be strictly earlier than the current one and strictly in the future. |

### How to tell them apart in one sentence each

- **Appeal** — *"the claimant thinks the DAO got it wrong."* Only reachable
  after a rejection, only by the claimant, and it runs a second vote.
- **Dispute** — *"the admin thinks an approval needs a second look before money
  moves."* Only reachable after an approval, only by the admin, and it stops
  the payout rather than re-voting.
- **Escalation** — *"nobody is voting and the claim is stuck."* Reachable only
  while voting is still open, only by the admin, and it changes the *schedule*,
  not the verdict.

### Why they can never overlap

Appeal requires `Rejected`; dispute requires `Approved`; escalation requires
`Processing`. Those three statuses are mutually exclusive points in the claim
lifecycle, so each mechanism's entry guard excludes the other two by
construction. `tests/appeal_dispute_mutual_exclusion.rs` asserts this for the
appeal/dispute pair.

### Related terms

- **`finalize_appeal`** — permissionless keeper call that closes an appeal
  round once `appeal_deadline_ledger` has passed. Not a fourth mechanism; it is
  how an appeal *ends*. Before the deadline it always returns
  `VotingWindowStillOpen`; an appeal that reaches quorum mid-round resolves
  inside `vote_on_appeal` instead.
- **`vote_on_appeal`** — casting a vote in an appeal round, as opposed to
  `vote_on_claim` for the original round.
- **`ClaimStatus::Appealed`** — a reserved, never-constructed enum variant kept
  only to avoid renumbering XDR discriminants. The live "appeal in progress"
  status is `UnderAppeal`. See `contracts/niffyinsure/src/types.rs`.
- **Withdrawal** (`withdraw_claim`) — the claimant retracting a claim *before*
  voting begins. Unrelated to appeals: there is no adverse decision to contest.

### Where these are implemented

- `contracts/niffyinsure/src/claim.rs` — `open_appeal`, `dispute_claim`,
  `escalate_claim`, `vote_on_appeal`, `finalize_appeal`
- `contracts/niffyinsure/src/lib.rs` — the corresponding contract entrypoints
  and their auth checks
- `contracts/niffyinsure/src/types.rs` — `ClaimStatus` discriminants
