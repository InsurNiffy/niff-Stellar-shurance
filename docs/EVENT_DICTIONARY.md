# niffyInsure — Event Dictionary

> **Schema version: 1**  
> `SCHEMA_VERSION` in `events.rs` and `events.schema.ts` must stay in sync.  
> Breaking changes (field removed / type changed) → semver-major contract release + `SCHEMA_VERSION` bump.  
> Adding new optional fields is backward-compatible; no bump required.
>
> **Ownership:** the contract author is responsible for updating this file on every contract release.  
> CI enforces that every event name in `events.rs` has a corresponding entry here (see `.github/workflows/ci.yml` — `check-event-dictionary` job).

## Units

| Type | Unit | Notes |
|------|------|-------|
| Token amounts | **stroops** (i128 as string) | 1 XLM = 10 000 000 stroops (7 decimals). Never use floats. |
| Time | **ledger sequence** (u32) | 1 ledger ≈ 5 s on Stellar mainnet. Multiply by 5 for wall-clock seconds. |
| Boolean flags | **u32** (0 / 1) | Matches ABI encoding. `1 = true`, `0 = false`. |
| Addresses | **Stellar address string** | Holder = `G…`, contract/asset = `C…`. |
| Image reference | **FNV-1a u64 hash** | Hash of concatenated IPFS CIDs. Full CIDs stored off-chain. |

---

## Topic layout

Every event has at least two topics:

```
topic[0]  namespace   "niffyins" (claim/admin events) | "niffyinsure" (policy events)
topic[1]  event name  see table below
topic[2+] identifiers claim_id, holder, asset, … (event-specific)
```

The indexer discriminates events by `${topic[0]}:${topic[1]}`.

---

## Admin Audit Event (`namespace = "niffyinsure"`)

### `admin_action` — immutable admin audit trail

Emitted after every successful admin-authenticated entrypoint. Failed or unauthorized calls do not emit this event.

**Topics:** `("niffyinsure", "admin_action")`

```json
{
  "actor": "G...",
  "action_type": "set_token",
  "params": {}
}
```

| Field | Type | Description |
|-------|------|-------------|
| `actor` | string (G...) | Authenticated account that authorized the admin operation |
| `action_type` | string | Stable machine-readable action name |
| `params` | object | String-keyed parameter map; currently emitted as `{}` to preserve the schema while avoiding address/string encoding ambiguity |

Stable `action_type` values:

`initialize`, `update_multiplier_table`, `admin_set_premium_multiplier`, `set_allowed_asset`, `admin_set_vote_duration_ledgers`, `admin_set_quorum_bps`, `set_grace_period_ledgers`, `process_claim`, `set_calculator`, `clear_calculator`, `admin_terminate_policy`, `propose_admin`, `accept_admin`, `cancel_admin`, `propose_admin_action`, `confirm_admin_action`, `cancel_admin_action`, `set_token`, `set_treasury`, `drain`, `sweep_token`, `set_sweep_cap`, `set_sweep_notice_period`, `admin_set_max_evidence_count`, `admin_set_gateway_allowlist`, `admin_set_asset_premium_table`, `pause`, `unpause`, `pause_bind`, `pause_claims`, `set_rolling_claim_cap`, `set_rolling_claim_window_ledgers`, `set_ttl_alert_threshold`, `gov_set_token_runtime_enabled`, `gov_set_token_address_stub`, `admin_set_open_claim_count`.

---

## Governance parameter events  (`namespace = "niffyins"`)

### `vote_dur_updated` — vote duration changed

Emitted when the admin updates the voting window length for claims.

**Topics:** `("niffyins", "vote_dur_updated")`

```json
{
  "version": 1,
  "old_vote_duration_ledgers": 17280,
  "new_vote_duration_ledgers": 34560,
  "at_ledger": 1234567
}
```

| Field | Type | Description |
|-------|------|-------------|
| `old_vote_duration_ledgers` | u32 (ledger) | Previous vote window length |
| `new_vote_duration_ledgers` | u32 (ledger) | New vote window length |
| `at_ledger` | u32 (ledger) | Ledger of the update |

**Emitting entrypoint:** `admin_set_vote_duration_ledgers`

---

### `grace_period_updated` — grace period changed

Emitted when the admin updates the post-expiry grace period for policies.

**Topics:** `("niffyins", "grace_period_updated")`

```json
{
  "version": 1,
  "old_grace_period_ledgers": 17280,
  "new_grace_period_ledgers": 8640,
  "at_ledger": 1234567
}
```

| Field | Type | Description |
|-------|------|-------------|
| `old_grace_period_ledgers` | u32 (ledger) | Previous grace period length |
| `new_grace_period_ledgers` | u32 (ledger) | New grace period length |
| `at_ledger` | u32 (ledger) | Ledger of the update |

**Emitting entrypoint:** `set_grace_period_ledgers`

---

## Claim events  (`namespace = "niffyins"`)

### `clm_filed` — claim filed

**Topics:** `("niffyins", "clm_filed", claim_id: u64, holder: Address)`

```json
{
  "version": 1,
  "policy_id": 3,
  "amount": "5000000",
  "evidence_hashes": ["<32-byte hex>"],
  "filed_at": 1234567
}
```

| Field | Type | Description |
|-------|------|-------------|
| `policy_id` | u32 | Per-holder policy identifier |
| `amount` | string (stroops) | Requested payout |
| `evidence_hashes` | string[] | SHA-256 digests (32 bytes each); on-chain commitment only |
| `filed_at` | u32 (ledger) | Ledger when claim was filed |

**Emitting entrypoint:** `file_claim`

---

### `vote_cast` — ballot cast

**Topics:** `("niffyins", "vote_cast", claim_id: u64, voter: Address)`

```json
{
  "version": 1,
  "vote": "Approve",
  "approve_votes": 2,
  "reject_votes": 1,
  "at_ledger": 1234568
}
```

| Field | Type | Description |
|-------|------|-------------|
| `vote` | `"Approve"` \| `"Reject"` | This voter's choice |
| `approve_votes` | u32 | Running approve tally after this vote |
| `reject_votes` | u32 | Running reject tally after this vote |

**Emitting entrypoint:** `vote_on_claim`

---

### `clm_final` — claim finalized

Emitted when voting reaches majority **or** the vote window expires.

**Topics:** `("niffyins", "clm_final", claim_id: u64)`

```json
{
  "version": 1,
  "status": "Approved",
  "approve_votes": 3,
  "reject_votes": 1,
  "at_ledger": 1355527
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"Approved"` \| `"Rejected"` | Final outcome |

**Emitting entrypoint:** `finalize_claim`

**Tie-breaking rule:** when `approve_votes == reject_votes` exactly (quorum
met but no majority either way), the claim resolves to **`Rejected`**, not
`Approved`. This is a strict `>` comparison on `approve_votes`, applied
identically whether the claim resolves early during voting
(`resolve_plurality_if_quorum_met`) or later via `finalize_claim` — so the
outcome for a tie is deterministic regardless of vote submission order. See
`contracts/niffyinsure/docs/GOVERNANCE.md` and the tie-break comment in
`finalize_claim_inner` (`contracts/niffyinsure/src/claim.rs`), and the
regression test `contracts/niffyinsure/tests/finalize_tie_vote.rs`.

---

### `proposal_expired` — governance proposal expired

Emitted when a governance proposal passes its deadline without reaching quorum
or confirmation.

**Topics:** `("niffyins", "proposal_expired", proposal_id: u64)`

```json
{
  "version": 1,
  "proposal_id": 7,
  "expired_at": 1355527
}
```

| Field | Type | Description |
|-------|------|-------------|
| `proposal_id` | u64 | Governance proposal identifier |
| `expired_at` | u32 (ledger) | Ledger at which the proposal expired |

**Emitting entrypoint:** `expire_proposal`

---

### `clm_paid` — payout executed

**Topics:** `("niffyins", "clm_paid", claim_id: u64)`

```json
{
  "version": 1,
  "recipient": "G...",
  "amount": "5000000",
  "asset": "C...",
  "at_ledger": 1355528
}
```

| Field | Type | Description |
|-------|------|-------------|
| `amount` | string (stroops) | Actual payout transferred |
| `asset` | string (C…) | Asset contract used for payout |

**Emitting entrypoint:** `process_claim`

---

### `claim_withdrawn` — claim withdrawn by claimant

Emitted when the claimant withdraws their own claim before any votes are cast.
Indexers must surface `Withdrawn` status distinctly on the claims board.

**Topics:** `("niffyinsure", "claim_withdrawn", claim_id: u64)`

```json
{
  "version": 1,
  "policy_id": 3,
  "claimant": "G...",
  "at_ledger": 1234600
}
```

| Field | Type | Description |
|-------|------|-------------|
| `policy_id` | u32 | Per-holder policy identifier |
| `claimant` | string (G…) | Address of the withdrawing claimant |
| `at_ledger` | u32 (ledger) | Ledger of withdrawal |

**Emitting entrypoint:** `withdraw_claim`

---

### `claim_status_changed` — claim status transition

Emitted on every claim status transition, including filing, vote resolution,
deadline finalization, payout, and withdrawal.

**Topics:** `("niffyins", "claim_status_changed", claim_id: u64)`

```json
{
  "version": 1,
  "old_status": "Processing",
  "new_status": "Approved",
  "at_ledger": 1355527
}
```

| Field | Type | Description |
|-------|------|-------------|
| `old_status` | ClaimStatus | Status before the transition (`Pending` is used for initial filing) |
| `new_status` | ClaimStatus | Status after the transition |
| `at_ledger` | u32 (ledger) | Ledger of the transition |

**Emitting entrypoint:** `file_claim`, `vote_on_claim`, `finalize_claim`, `process_claim`, `withdraw_claim`

---

## Region events  (`namespace = "niffyinsure"`)

### `region_upserted` — region config created or updated

Emitted when an admin creates or updates an entry in the region registry.

**Topics:** `("niffyinsure", "region_upserted", region: String)`

```json
{
  "version": 1,
  "parent": "US",
  "risk_multiplier": 12000,
  "active": 1,
  "created": 1,
  "at_ledger": 1234567
}
```

| Field | Type | Description |
|-------|------|-------------|
| `region` (topic) | string | Region code (1..=32 bytes, `REGION_CODE_MAX_LEN`) |
| `parent` | string | Parent region code (empty = no parent) |
| `risk_multiplier` | i128 (bps) | Risk multiplier, 10_000 = 1x; bounded by `MIN_MULTIPLIER..=MAX_MULTIPLIER` |
| `active` | u32 | 1 = accepts new policies, 0 = deactivated |
| `created` | u32 | 1 = new entry, 0 = existing entry overwritten |
| `at_ledger` | u32 (ledger) | Ledger of the upsert |

**Emitting entrypoint:** `upsert_region` (legacy alias: `admin_set_region`)

---

### `region_removed` — region config removed

Emitted when an admin removes an entry from the region registry. Not emitted
when the region is unknown (the call fails with `RegionError::RegionNotFound`).

**Topics:** `("niffyinsure", "region_removed", region: String)`

```json
{
  "version": 1,
  "at_ledger": 1234567
}
```

| Field | Type | Description |
|-------|------|-------------|
| `region` (topic) | string | Region code that was removed |
| `at_ledger` | u32 (ledger) | Ledger of the removal |

**Emitting entrypoint:** `remove_region` (legacy alias: `admin_remove_region`)

---

## Reinsurance events  (`namespace = "niffyinsure"`)

### `reinsurance_triggered` — reinsurance layer activated

Emitted when aggregate claim exposure crosses the reinsurance threshold and the
reinsurance layer is engaged.

**Topics:** `("niffyinsure", "reinsurance_triggered")`

```json
{
  "version": 1,
  "threshold": "100000000000",
  "exposure": "120000000000",
  "at_ledger": 1234567
}
```

| Field | Type | Description |
|-------|------|-------------|
| `threshold` | string (stroops) | Reinsurance trigger threshold |
| `exposure` | string (stroops) | Aggregate exposure at trigger time |
| `at_ledger` | u32 (ledger) | Ledger of the trigger |

**Emitting entrypoint:** `process_claim`

---

## Policy lifecycle events  (`namespace = "niffyinsure"`)

### `PolicyInitiated` — policy bound

**Topics:** `("niffyinsure", "PolicyInitiated", holder: Address)`

```json
{
  "version": 1,
  "policy_id": 1,
  "premium": "500000",
  "asset": "C...",
  "policy_type": "Auto",
  "region": "Medium",
  "coverage": "50000000",
  "start_ledger": 1234567,
  "end_ledger": 2285767
}
```

| Field | Type | Description |
|-------|------|-------------|
| `policy_id` | u32 | Per-holder identifier (not globally unique; use `holder + policy_id`) |
| `premium` | string (stroops) | Premium paid at bind time |
| `policy_type` | `"Auto"` \| `"Health"` \| `"Property"` | Coverage category |
| `region` | `"Low"` \| `"Medium"` \| `"High"` | Geographic risk tier |
| `coverage` | string (stroops) | Maximum payout |
| `end_ledger` | u32 (ledger) | Expiry ledger |

**Emitting entrypoint:** `initiate_policy`

---

### `PolicyRenewed` — policy renewed

**Topics:** `("niffyinsure", "PolicyRenewed", holder: Address)`

```json
{
  "version": 1,
  "policy_id": 1,
  "premium": "500000",
  "new_end_ledger": 3336967,
  "old_coverage_type": "Basic",
  "new_coverage_type": "Standard",
  "old_coverage": "50000000",
  "new_coverage": "100000000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `policy_id` | u32 | Per-holder policy identifier |
| `premium` | string (stroops) | Premium paid at renewal |
| `new_end_ledger` | u32 (ledger) | New expiry ledger |
| `old_coverage_type` | string | Coverage tier before renewal |
| `new_coverage_type` | string | Coverage tier after renewal |
| `old_coverage` | string (stroops) | Coverage limit before renewal |
| `new_coverage` | string (stroops) | Coverage limit after renewal |

**Emitting entrypoint:** `renew_policy`
