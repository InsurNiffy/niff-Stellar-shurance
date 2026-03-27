# niffyInsure — Event Dictionary

> **Schema version: 1**  
> Breaking changes (field removed / type changed) → semver-major contract release + `SCHEMA_VERSION` bump.  
> Adding new optional fields is backward-compatible; no bump required.

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

## Claim events  (`namespace = "niffyins"`)

### `clm_filed` — claim filed

**Topics:** `("niffyins", "clm_filed", claim_id: u64, holder: Address)`

```json
{
  "version": 1,
  "policy_id": 3,
  "amount": "5000000",
  "image_hash": 2864434397,
  "filed_at": 1234567
}
```

| Field | Type | Description |
|-------|------|-------------|
| `policy_id` | u32 | Per-holder policy identifier |
| `amount` | string (stroops) | Requested payout |
| `image_hash` | u64 | FNV-1a hash of IPFS CIDs |
| `filed_at` | u32 (ledger) | Ledger when claim was filed |

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

---

### `PolicyRenewed` — policy renewed

**Topics:** `("niffyinsure", "PolicyRenewed", holder: Address)`

```json
{
  "version": 1,
  "policy_id": 1,
  "premium": "500000",
  "new_end_ledger": 3336967
}
```

---

### `PolicyTerminated` — policy terminated

**Topics:** `("niffyinsure", "policy_terminated", holder: Address, policy_id: u32)`

```json
{
  "reason_code": 1,
  "terminated_by_admin": 0,
  "open_claim_bypass": 0,
  "open_claims": 0,
  "at_ledger": 1234600
}
```

| `reason_code` | Meaning |
|---------------|---------|
| 1 | VoluntaryCancellation |
| 2 | LapsedNonPayment |
| 3 | UnderwritingVoid |
| 4 | FraudOrMisrepresentation |
| 5 | RegulatoryAction |
| 6 | AdminOverride |

---

## Admin / config events  (`namespace = "niffyins"`)

| Event | Topics | Key payload fields |
|-------|--------|--------------------|
| `tbl_upd` | `(NS, "tbl_upd")` | `table_version: u32` |
| `asset_set` | `(NS, "asset_set", asset)` | `allowed: 0\|1` |
| `adm_prop` | `(NS, "adm_prop", old_admin, new_admin)` | `version` only |
| `adm_acc` | `(NS, "adm_acc", old_admin, new_admin)` | `version` only |
| `adm_can` | `(NS, "adm_can", admin, cancelled_pending)` | `version` only |
| `adm_tok` | `(NS, "adm_tok")` | `old_token`, `new_token` |
| `adm_paus` | `(NS, "adm_paus", admin)` | `paused: 0\|1` |
| `adm_drn` | `(NS, "adm_drn", admin)` | `recipient`, `amount` (stroops) |

---

## Versioning & migration

1. `SCHEMA_VERSION` in `events.rs` and `events.schema.ts` must stay in sync.
2. A version bump is **required** when any field is removed or its type changes.
3. The `EVENT_PARSERS` table in `events.schema.ts` maps `version → parser`; add a new entry for each bump and keep old entries for historical replay.
4. CI regression tests in `events.test.ts` will fail on shape changes — this is intentional.

---

## What is NOT in events

- Raw IPFS URLs (use `image_hash` to look up off-chain).
- Claim description text.
- Voter lists (derive from `vote_cast` stream).
- PII of any kind.
