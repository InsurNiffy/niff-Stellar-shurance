# NiffyInsur Smart Contract Security Model

This document is the audit-prep security brief for `contracts/niffyinsure`.
It is intentionally concrete: auditors need the trusted roles, privileged
operations, external calls, known assumptions, and quarantined coverage gaps in
one place.

## Admin Privileges & Centralization Risks

### Two-Step Confirmation (Protected Operations)

High-risk operations require **two-step confirmation** to reduce the blast radius of a
compromised admin key. A single signature cannot execute these operations.

| Operation | Entrypoint Flow |
|-----------|-----------------|
| **Treasury Rotation** | `propose_admin_action(AdminAction::treasury_rotation(new_treasury))` → `confirm_admin_action(confirmer)` |
| **Token Sweep** | `propose_admin_action(AdminAction::token_sweep(asset, recipient, amount, reason_code))` → `confirm_admin_action(confirmer)` |

**How it works:**

1. **Proposer** — current admin calls `propose_admin_action`. Stores `PendingAdminAction { proposer, action, expiry_ledger }` and emits `AdminActionProposed`.
2. **Confirmer** — a *different* address calls `confirm_admin_action(confirmer)`. The confirmer must not equal the proposer (`CannotSelfConfirm`). On success, the action executes and `AdminActionConfirmed` is emitted.
3. **Expiry** — if `confirm_admin_action` is called after `expiry_ledger`, the pending entry is cleared, `AdminActionExpired` is emitted, and the call reverts. Expired proposals are inert and cannot be replayed.
4. **Cancellation** — the proposer (current admin) may call `cancel_admin_action` at any time before expiry to withdraw the proposal.

**Configurable window:** `AdminActionWindowLedgers` (default 100 ledgers ≈ 8 min at 5 s/ledger).
Admin can adjust via `propose_admin_action` + `confirm_admin_action` on a config-change action.

### Single-Step Operations (Lower Risk)

These remain single-admin for MVP operational needs:

| Operation | Description | Risk Mitigation |
|-----------|-------------|-----------------|
| `set_token` | Update default policy token | Multisig admin |
| `drain` | Emergency treasury withdrawal | Protected balance checks |
| `pause`/`unpause` | Emergency protocol halt | Granular flags, events |
| Config setters (quorum, evidence count, etc.) | Parameter tuning | Bounded values, events |
| Asset allowlist updates | Enable or disable accepted SEP-41 assets | Admin auth, event trail, per-policy asset binding |
| Policy admin termination | Operational recovery for exceptional policies | Admin auth, open-claim guard unless explicit bypass |
| Operation | Risk Mitigation |
|-----------|-----------------|
| `set_token` | Multisig admin recommended |
| `drain` | Protected balance checks |
| `pause` / `unpause` | Granular flags, events |
| Config setters (quorum, evidence count, etc.) | Bounded values, events |

### Admin Rotation

Independent two-step: `propose_admin` → `accept_admin` / `cancel_admin`.

## Multisig Recommendation

- **Production**: 3-of-5 Stellar multisig as admin.
- **Proposer role**: hot key (online, lower threshold).
- **Confirmer role**: cold key (offline, higher threshold).
- **Recovery**: documented in ops runbook.

## Storage Security

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
- **TTL Management**: Instance bumped on mutations; persistent extended to ~1 yr.
- **Protected Balances**: Sweeps validate unpaid approved claims are preserved.
- **Allowlists**: Sweep assets must be explicitly approved.

## Audit Events

All admin actions emit structured events for indexer / NestJS monitoring:

| Event | Topics | Emitted when |
|-------|--------|--------------|
| `AdminActionProposed` | `["niffyinsure", "admin_action_proposed"]` | Proposal stored |
| `AdminActionConfirmed` | `["niffyinsure", "admin_action_confirmed"]` | Action executed |
| `AdminActionExpired` | `["niffyinsure", "admin_action_expired"]` | Confirm called after expiry |

## Audit Status

- [ ] Internal review complete
- [ ] External audit pending
