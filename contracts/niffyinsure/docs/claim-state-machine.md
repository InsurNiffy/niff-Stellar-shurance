# Claim State Machine — Valid Status Transitions

This document defines every valid `ClaimStatus` transition in the niffyinsure
contract. Any transition not listed below **must revert**.

## Status Variants

| Discriminant | Status | Terminal? | Description |
|---|---|---|---|
| 0 | Processing | No | Initial state at filing |
| 1 | Pending | No | Awaiting voter action |
| 2 | Approved | Yes | Majority approved; awaiting payout |
| 3 | PayoutTimeout | Yes | Approved but payout deadline passed |
| 4 | Paid | Yes | Payout successfully executed |
| 5 | Rejected | Yes* | Majority rejected (*appeal may reopen) |
| 6 | UnderAppeal | No | Appeal vote in progress |
| 7 | AppealApproved | Yes | Appeal majority approved |
| 8 | AppealRejected | Yes | Appeal majority rejected |
| 9 | Withdrawn | Yes | Claimant withdrew before voting |
| 10 | Disputed | Yes | Admin disputed after approval |
| 11 | Appealed | — | RESERVED (never constructed) |

## State Machine Diagram

```mermaid
stateDiagram-v2
    [*] --> Processing : file_claim

    Processing --> Pending : (internal, after snapshot)
    Processing --> Withdrawn : withdraw_claim (before any vote)

    Pending --> Approved : finalize_claim (majority approve)
    Pending --> Rejected : finalize_claim (majority reject / deadline)

    Approved --> Paid : process_claim (payout executed)
    Approved --> PayoutTimeout : (payout deadline passed)
    Approved --> Disputed : admin_dispute_claim (within dispute window)

    Rejected --> UnderAppeal : open_appeal (within APPEAL_OPEN_WINDOW_LEDGERS)

    UnderAppeal --> AppealApproved : finalize_appeal (majority approve)
    UnderAppeal --> AppealRejected : finalize_appeal (majority reject)

    AppealApproved --> Paid : process_claim (payout executed)
    AppealApproved --> PayoutTimeout : (payout deadline passed)

    Paid --> [*]
    PayoutTimeout --> [*]
    AppealRejected --> [*]
    Withdrawn --> [*]
    Disputed --> [*]
```

## Transition Rules

### Forward-only transitions
All transitions are strictly forward — no status may revert to a previous
state. The only exception is `Rejected → UnderAppeal`, which reopens the
claim for an appeal vote round.

### Terminal states
Terminal states (where `is_terminal()` returns `true`) are:
`Approved`, `PayoutTimeout`, `Paid`, `Rejected`, `AppealApproved`,
`AppealRejected`, `Withdrawn`, `Disputed`.

`UnderAppeal` is explicitly **not** terminal — the appeal must resolve
before the claim lifecycle ends.

### Invalid transitions (must revert)
Any direct transition not shown in the diagram above must revert.
Examples of invalid transitions:
- `Paid → Processing` (cannot restart a paid claim)
- `Withdrawn → Approved` (cannot approve a withdrawn claim)
- `Disputed → Pending` (cannot re-pend a disputed claim)
- `AppealRejected → UnderAppeal` (cannot re-appeal)

## References
- Source: `contracts/niffyinsure/src/claim.rs`
- Types: `contracts/niffyinsure/src/types.rs` (`ClaimStatus` enum)
- Events: `contracts/niffyinsure/src/events.rs` (`ClaimStatusChangedData`)
