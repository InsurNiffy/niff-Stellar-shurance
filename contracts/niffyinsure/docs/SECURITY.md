# NiffyInsure Smart Contract Security Model

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
