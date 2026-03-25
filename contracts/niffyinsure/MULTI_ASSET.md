# Multi-Asset Configuration

## Overview

NiffyInsure supports multiple SEP-41 asset contracts for premium payments and claim payouts.
Each policy is **bound to a single asset** at initiation time; that same asset is used for
both the premium transfer and any future claim payout. Cross-asset settlement is not supported
in the MVP.

## Contract Design

### Allowlist

The admin maintains an allowlist of permitted SEP-41 asset contract IDs stored in instance
storage at `DataKey::AllowedAsset(Address)`. Only allowlisted assets may be used in
`initiate_policy` or `process_claim`.

Admin entrypoints:
- `set_allowed_asset(asset, true)` — add to allowlist, emits `("asset", "added")` event.
- `set_allowed_asset(asset, false)` — remove from allowlist, emits `("asset", "removed")` event.
- `is_allowed_asset(asset)` — read-only check.

### Per-Policy Asset Binding

`initiate_policy` accepts an `asset: Address` parameter. The asset is:
1. Validated against the allowlist before any auth or state changes.
2. Used for the premium `transfer` call (holder → contract treasury).
3. Stored in the `Policy` struct as `policy.asset`.

`process_claim` validates:
1. The claim's `asset` field is still allowlisted.
2. The claim's `asset` matches the bound policy's `asset`.

This prevents a scenario where an admin removes an asset after policies are written but
before claims are paid — such claims will fail `process_claim` until the asset is
re-allowlisted or the claim is manually resolved.

### Events

| Topic | Data | When |
|-------|------|------|
| `("asset", "added")` | `asset: Address` | Admin adds asset to allowlist |
| `("asset", "removed")` | `asset: Address` | Admin removes asset from allowlist |
| `PolicyInitiated` | includes `asset: Address` | Policy created |
| `ClaimProcessed` | includes `asset: Address` | Claim paid out |

Indexers should subscribe to `("asset", "added")` and `("asset", "removed")` to maintain
an up-to-date off-chain allowlist mirror in the `allowed_assets` Prisma table.

## Backend / Indexer Needs

### Symbol and Decimals Metadata

The contract stores only the SEP-41 contract address. Symbol and decimal metadata must be
fetched off-chain:

1. **On `AssetAdded` event**: the indexer should call the SEP-41 `name()`, `symbol()`, and
   `decimals()` view functions on the asset contract and persist the result in the
   `AllowedAsset` Prisma model.
2. **Fallback**: if the asset contract does not implement optional SEP-41 metadata, default
   to `symbol = null`, `decimals = 7` (Stellar native precision).
3. **Display**: the frontend should use `AllowedAsset.symbol` and `AllowedAsset.decimals`
   to format amounts. Never assume 7 decimals for non-XLM assets.

### Prisma Schema

```prisma
model AllowedAsset {
  contractId    String   @id   // SEP-41 contract address
  symbol        String?        // e.g. "USDC", "XLM"
  decimals      Int      @default(7)
  isAllowed     Boolean  @default(true)
  addedAtLedger Int?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

`Policy.assetContractId` is a nullable string FK (nullable for legacy policies).

### Backend API

`POST /policy/build-transaction` accepts an optional `asset` field (Stellar contract address,
`C...` format). If omitted, the backend falls back to `DEFAULT_TOKEN_CONTRACT_ID` from env.

## Product Stance on Volatile Assets

> **Warning**: Using volatile assets (e.g. XLM, non-stablecoin tokens) for insurance
> premiums and payouts introduces basis risk. If the asset depreciates between premium
> collection and claim payout, the treasury may be undercollateralised in real terms.

**Recommended MVP stance**:
- Allowlist only audited stablecoins (e.g. USDC on Stellar) for production deployments.
- XLM may be used on testnet for development convenience.
- Document the asset list in your deployment runbook and require multisig admin approval
  to add new assets.

## Admin Safety for Outstanding Liabilities

Removing an asset from the allowlist **does not** automatically cancel existing policies
bound to that asset. The following manual process is required:

1. **Before removal**: query all active policies with `assetContractId = <asset>` from the
   backend database.
2. **Assess exposure**: sum outstanding coverage amounts to understand liability.
3. **Communicate**: notify affected policyholders of the asset change.
4. **Remove**: call `set_allowed_asset(asset, false)`.
5. **Effect**: new policies cannot use the asset; existing claims against that asset will
   fail `process_claim` until re-allowlisted or manually resolved off-chain.

The contract cannot enforce automatic migration of existing policies to a new asset because
that would require modifying immutable policy records and could violate policyholder
expectations. This is a deliberate MVP trade-off; a future upgrade may add a
`migrate_policy_asset` admin entrypoint with appropriate governance controls.

## Single-Asset MVP Path

The code is structured to extend cleanly:
- `initialize(admin, token)` automatically allowlists `token` as the default asset.
- If all callers pass the same `asset` value, behaviour is identical to the single-asset design.
- The `DEFAULT_TOKEN_CONTRACT_ID` env var lets the backend default to the original token
  without requiring frontend changes.
