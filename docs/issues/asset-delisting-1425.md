# Asset allowlist delisting behaviour (issue #1425)

## Decision

**Grandfather active policies.** Delisting an asset via
`set_allowed_asset(asset, false)` blocks **new** binds and **renewals** for that
asset, but does **not** break existing policies:

| Action | Delisted asset |
|--------|----------------|
| `initiate_policy` | ❌ rejected (`AssetNotAllowed`) |
| `renew_policy` | ❌ rejected (`AssetNotAllowed`) |
| `file_claim` on an already-bound policy | ✅ allowed |
| Claim payout / refund on bound asset | ✅ allowed (uses `transfer_bound_asset`) |
| Admin payout-asset **override** | ❌ still must be allowlisted |

## Rationale

Policyholders paid premiums under the bound asset. Revoking the allowlist must
not strand active coverage or unpaid approved claims. Operators who need a hard
stop should pause claims (`claims_paused`) or terminate policies through the
existing admin lifecycle path.

## Events

Every `set_allowed_asset` call emits `AssetAllowlistUpdated` (topic
`asset_allowlist_updated`) in addition to the legacy `allowed_asset_updated` /
`asset_set` payloads for indexer compatibility.
