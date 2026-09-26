# Contract Event Schema

This document defines the canonical topic layout used by `niffyinsure` contract
events so indexers and clients can filter and decode events without per-event
special casing.

## Canonical topic layout

```
[contract_name, event_name, entity_id?, actor?]
```

- `contract_name` — always the literal `"niffyinsure"` (topic 0).
- `event_name` — a short symbol identifying the event, e.g. `"claim_filed"` (topic 1).
- `entity_id` (optional) — the primary domain identifier the event is about
  (e.g. `claim_id`, `policy_id`, or a `(holder, policy_id)` pair).
- `actor` (optional) — the address that triggered or is most affected by the
  event (e.g. `voter`, `claimant`, `holder`), when distinct from `entity_id`.

Non-topic fields (amounts, statuses, vote tallies, ledger numbers, etc.) belong
in the event **data** payload, not the topic vector.

## Examples

| Event | Topics | Data |
|---|---|---|
| `ClaimFiled` | `["niffyinsure", "claim_filed", claim_id]` | `holder, policy_id, claim_amount, deductible, evidence_hashes` |
| `ClaimRejected` | `["niffyinsure", "claim_rejected", claim_id]` | `policy_id, claimant, reject_votes, approve_votes, at_ledger` |
| `StrikeIncremented` | `["niffyinsure", "strike_incremented", holder, policy_id]` | `claim_id, strike_count` |
| `PolicyDeactivated` | `["niffyinsure", "policy_deactivated", holder, policy_id]` | `reason_code, at_ledger` |
| `AppealOpened` | `["niffyinsure", "appeal_opened", claim_id]` | `policy_id, claimant, appeal_deadline_ledger, quorum_bps, at_ledger` |
| `AppealVoteCast` | `["niffyinsure", "appeal_vote_cast", claim_id, voter]` | `vote, at_ledger` |

## Known deviations

The legacy events defined in `src/events.rs` (e.g. `ClaimFiledData`,
`VoteCastData`, `AdminProposedData`) use a different, abbreviated
`"niffyins"` contract-name topic and shortened event names (`"clm_filed"`,
`"adm_prop"`, ...). These predate the canonical layout above and have not yet
been migrated. New events must follow the canonical layout defined in this
document; migrating the legacy `events.rs` module is tracked as follow-up
work.

## Testing

Topic ordering for representative events is asserted in
[`tests/event_topic_layout.rs`](../tests/event_topic_layout.rs).
