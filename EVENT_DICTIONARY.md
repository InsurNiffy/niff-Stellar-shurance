# Event Dictionary

This document is the canonical registry of every event emitted by the NiffyInsure
contracts. It is validated in CI: the `event-dictionary` job parses this file and
cross-references it against every `#[contractevent]` struct in
`contracts/niffyinsure/src/events.rs`. If any contract event is missing from the
tables below, CI fails and prints a diff of the undocumented events.

## How the validator works

- Every `#[contractevent]` struct in `contracts/niffyinsure/src/events.rs` must
  have a matching row in one of the tables below.
- The match key is the **event name** (the struct name, e.g. `PolicyIssued`),
  written in the first column of each table.
- Rows are matched case-insensitively against the struct name; the validator
  normalises `PolicyIssued`, `policy_issued`, and `policy-issued` to the same key.
- Adding a new `#[contractevent]` struct without a corresponding row here will
  fail CI with a diff listing the undocumented event(s).

## Event entries

| Event | Topic | Emitted by | Description |
| --- | --- | --- | --- |
| `PolicyIssued` | `policy` | `issue_policy` | A new policy has been issued for a holder. |
| `PolicyRenewed` | `policy` | `renew_policy` | An existing policy has been renewed for a new term. |
| `PolicyCancelled` | `policy` | `cancel_policy` | A policy has been cancelled by the holder or admin. |
| `ClaimFiled` | `claim` | `file_claim` | A claim has been filed against a policy. |
| `ClaimApproved` | `claim` | `approve_claim` | A filed claim has been approved for payout. |
| `ClaimRejected` | `claim` | `reject_claim` | A filed claim has been rejected. |
| `ClaimPaid` | `claim` | `pay_claim` | An approved claim has been paid out. |
| `PremiumPaid` | `premium` | `pay_premium` | A premium payment has been recorded. |
| `GovernanceProposalCreated` | `governance` | `propose` | A new governance proposal has been created. |
| `GovernanceProposalExecuted` | `governance` | `execute` | A governance proposal has been executed. |
| `OraclePriceUpdated` | `oracle` | `update_price` | The oracle price feed has been updated. |

> Keep this table in sync with `contracts/niffyinsure/src/events.rs`. The CI
> validator is the source of truth for completeness; this table is the source
> of truth for documentation.
