# NiffyInsure Smart Contract Security Model

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

## Event Schema
All admin actions emit structured events for indexer monitoring:
- Topics: `["niffyinsure", "admin_*"]`
- Full dictionary: EVENT_DICTIONARY.md

## Audit Status
- [ ] Internal review complete
- [ ] External audit pending

Last Updated: $(date)
