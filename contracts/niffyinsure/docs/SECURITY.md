# NiffyInsur Smart Contract Security Model

This document is the audit-prep security brief for `contracts/niffyinsure`.
It is intentionally concrete: auditors need the trusted roles, privileged
operations, external calls, known assumptions, and quarantined coverage gaps in
one place.

## Admin Privileges & Centralization Risks

### Two-Step Confirmation (Protected Operations)
High-risk operations require **two-step confirmation** to mitigate compromised key risks:

| Operation | Description | Entrypoint Flow |
|-----------|-------------|-----------------|
| **Treasury Rotation** | Change treasury address for premium collection/payouts | `propose_admin_action(TreasuryRotation { new_treasury })` → `confirm_admin_action()` |
| **Token Sweep** | Emergency recovery of misplaced tokens | `propose_admin_action(TokenSweep { asset, recipient, amount, reason_code })` → `confirm_admin_action()` |

- **Proposer**: Current admin authorizes proposal.
- **Confirmer**: Second signer (≠ proposer) authorizes execution within configurable window (~30min default).
- **Expiry**: Automatic; emits `AdminActionExpired`, inert against replay.
- **Audit Trail**: `AdminActionProposed` / `AdminActionConfirmed` / `AdminActionExpired` events.

### Single-Step Fallback (Lower Risk)
These remain single-admin for MVP operational needs:

| Operation | Description | Risk Mitigation |
|-----------|-------------|-----------------|
| `set_token` | Update default policy token | Multisig admin |
| `drain` | Emergency treasury withdrawal | Protected balance checks |
| `pause`/`unpause` | Emergency protocol halt | Granular flags, events |
| Config setters (quorum, evidence count, etc.) | Parameter tuning | Bounded values, events |
| Asset allowlist updates | Enable or disable accepted SEP-41 assets | Admin auth, event trail, per-policy asset binding |
| Policy admin termination | Operational recovery for exceptional policies | Admin auth, open-claim guard unless explicit bypass |

### Admin Rotation
Independent two-step: `propose_admin` → `accept_admin` / `cancel_admin`.

## Multisig Recommendation
- **Production**: 3-of-5 Stellar multisig as admin.
- **Roles**: Proposer (hot key), Confirmers (cold keys).
- **Recovery**: Documented in ops runbook.

## Storage Security
- **TTL Management**: Instance bumped on mutations; persistent extended to ~1yr.
- **Protected Balances**: Sweeps validate unpaid claims preserved.
- **Allowlists**: Sweep assets explicitly approved.

## External Calls

| Surface | External Contract | Purpose | Security Assumption |
|---------|-------------------|---------|---------------------|
| Premium payment | SEP-41 token contract | Pull premium from policyholder into treasury | Token contract follows Stellar asset semantics; holder approval is required before transfer |
| Claim payout | SEP-41 token contract | Transfer approved payout to holder or beneficiary | Contract balance covers payout; payout asset matches policy-bound asset |
| Emergency sweep | SEP-41 token contract | Move explicitly allowlisted excess tokens to recipient | Sweep cap and protected-balance checks prevent draining reserved claim funds |
| Cross-contract quote calculator | Optional calculator contract | Quote premiums when configured | Admin controls calculator address; local fallback remains the baseline |
| Oracle triggers | Feature-gated experimental module | Future trigger validation | Disabled in default builds; default calls panic with `ORACLE_TRIGGERS_DISABLED` |

No untrusted callback is expected during policy, claim, vote, or admin state
mutation. Token transfers are the primary external-call boundary and must remain
covered by multi-asset and emergency-sweep tests.

## Threat Model

| ID | Threat | Control | Coverage |
|----|--------|---------|----------|
| AUTH-01 | Non-admin invokes privileged entrypoints | Stored admin `require_auth`; negative auth tests | `tests/security.rs`, `tests/admin.rs`, `tests/emergency_sweep.rs` |
| AUTH-02 | Admin rotation hijacked by unrelated signer | Pending admin must accept with its own auth | `tests/security.rs` |
| AUTH-03 | Contract initialized twice | Initialization guard | `tests/security.rs`, `tests/integration.rs` |
| AUTH-04 | Admin proposal lifecycle misuse | Missing proposal reverts; cancel clears pending admin | `tests/security.rs` |
| TOKEN-01 | Invalid token movement amount | Reject zero/negative drain or sweep amounts | `tests/security.rs`, `tests/emergency_sweep.rs` |
| TOKEN-02 | Non-admin drains or sweeps funds | Admin auth plus allowlist checks | `tests/security.rs`, `tests/emergency_sweep.rs` |
| TOKEN-03 | Payout uses wrong asset | Policy-bound asset enforced | `tests/multi_asset.rs` |
| CLAIM-01 | Claim exceeds policy coverage or deductible rules | Claim validation and deductible tests | `tests/deductible.rs`, `tests/voting.rs` |
| VOTE-01 | Ineligible or duplicate voter changes outcome | Active-policy eligibility, snapshot TTL, duplicate vote guards | `tests/voting.rs`, `tests/claim_voter_snapshot_ttl.rs` |
| GOV-01 | Quorum/duration config produces unsafe values | Bounded admin setters | `tests/quorum_governance.rs`, `tests/voting_duration_config.rs` |
| OPS-01 | Pause/unpause masks critical paths incorrectly | Granular pause flag tests | `tests/admin.rs`, `tests/security.rs` |
| EVENT-01 | Indexer misses critical state transition | Structured event dictionary and event tests | `tests/events_integration_stale.rs` is quarantined; current event coverage exists in focused flow tests |

## Quarantined Tests

`quarantine/events_integration_stale.rs` remains intentionally quarantined. It
asserts legacy event topics such as `niffyins` / `adm_paus`, while the contract
now emits current `#[contractevent]` topics such as `niffyinsure` and
`pause_toggled`. Restoring it without rewriting the expected schema would create
false failures and hide the real audit signal.

Before external audit, either:

1. Rewrite the quarantined tests against the current `EVENT_DICTIONARY.md`
   topics and move them into `tests/`, or
2. Keep them quarantined and file a signed audit exception that names the
   replacement coverage.

## Coverage Gate

Audit readiness requires:

- `cargo test` passing in `contracts/niffyinsure`.
- `cargo tarpaulin --out Html` run from `contracts/niffyinsure`.
- Line coverage at or above 90%.
- Any excluded or quarantined test documented in this file or
  `docs/ops/audit-exceptions.md`.

Do not claim the 90% gate is met unless the tarpaulin report for the exact
audited commit confirms it.

## Event Schema
All admin actions emit structured events for indexer monitoring:
- Topics: `["niffyinsure", "admin_*"]`
- Full dictionary: EVENT_DICTIONARY.md

## Audit Status
- [x] Admin operations documented
- [x] External calls documented
- [x] Quarantined event-schema tests documented
- [ ] Internal review complete
- [ ] External audit pending

Last Updated: 2026-04-26
