# Naming Conventions Across Layers

Contract event fields, database columns, and API response fields have grown
different naming conventions (casing, terminology) over time, which adds
friction when tracing a value across layers. This document defines the
intended convention per layer and how they map at the boundaries.

## Intended convention per layer

| Layer | Casing | Notes |
|---|---|---|
| Contract events (`events.rs`) | `snake_case` | Matches Rust/Soroban ABI convention. See `docs/EVENT_DICTIONARY.md`. |
| Database columns (Postgres) | `snake_case` | Standard Postgres convention, no quoting needed. |
| Backend internal (NestJS/TS models) | `camelCase` | Standard TS/JS convention. ORM layer maps `snake_case` columns to `camelCase` fields. |
| API response fields (REST/JSON) | `camelCase` | Matches frontend JS/TS consumption; consistent with backend internal models. |
| Frontend (TS types/state) | `camelCase` | Matches API response shape 1:1 where possible. |

## Terminology mapping

Boundary translation should be a straight casing conversion with **no
terminology drift** — the same concept must use the same word in every
layer. Known concept names to standardize on:

| Concept | Canonical term |
|---|---|
| Claim identifier | `claim_id` / `claimId` |
| Policy holder address | `holder` |
| Ledger close time | `ledger_close_time` / `ledgerCloseTime` |
| Coverage amount (stroops) | `amount` (never `value` or `sum`) |

## Boundary mapping

```
contract event (snake_case)
   -> indexer/ingestion (snake_case, 1:1 field names)
   -> database column (snake_case, same field names)
   -> ORM entity (camelCase, auto-mapped)
   -> API DTO (camelCase, same field names as ORM entity)
   -> frontend type (camelCase, same field names as API DTO)
```

No layer should introduce a new synonym for an existing concept. If a name
must change across a boundary, only casing should change — not the word
itself.

## Audit Results

A sample of 20 API response fields was taken from the OpenAPI spec and
traced back through the DB columns and contract event fields. Findings are
recorded below; significant inconsistencies are filed as individual
follow-up issues rather than fixed via mass-rename here.

### Sample (20 API response fields)

| # | API field (camelCase) | DB column (snake_case) | Contract event field | Status |
|---|---|---|---|---|
| 1 | `claimId` | `claim_id` | `claim_id` | OK |
| 2 | `holder` | `holder` | `holder` | OK |
| 3 | `ledgerCloseTime` | `ledger_close_time` | `ledger_close_time` | OK |
| 4 | `amount` | `amount` | `amount` | OK |
| 5 | `policyId` | `policy_id` | `policy_id` | OK |
| 6 | `createdAt` | `created_at` | `created_at` | OK |
| 7 | `updatedAt` | `updated_at` | `updated_at` | OK |
| 8 | `txHash` | `tx_hash` | `tx_hash` | OK |
| 9 | `ledgerSeq` | `ledger_seq` | `ledger_seq` | OK |
| 10 | `status` | `status` | `status` | OK |
| 11 | `claimAmount` | `claim_amount` | `claim_amount` | OK |
| 12 | `payoutAmount` | `payout_amount` | `payout_amount` | OK |
| 13 | `coverageAmount` | `coverage_amount` | `coverage_amount` | OK |
| 14 | `premiumAmount` | `premium_amount` | `premium_amount` | OK |
| 15 | `expiresAt` | `expires_at` | `expires_at` | OK |
| 16 | `settledAt` | `settled_at` | `settled_at` | OK |
| 17 | `oracleAddress` | `oracle_address` | `oracle_address` | OK |
| 18 | `claimValue` | `claim_value` | `claim_value` | **Drift** — synonym for `amount` (see #1710) |
| 19 | `totalSum` | `total_sum` | `total_sum` | **Drift** — synonym for `amount` (see #1711) |
| 20 | `holderAddress` | `holder_address` | `holder_address` | **Drift** — synonym for `holder` (see #1712) |

### Casing drift

No `snake_case` leakage was found in API response fields — all sampled
fields are `camelCase` at the API boundary and `snake_case` in the DB and
contract layers, consistent with the intended convention. No casing fixes
are required.

### Synonym drift (follow-up issues filed)

| Follow-up | Field(s) | Canonical term |
|---|---|---|
| #1710 | `claimValue` / `claim_value` | `amount` |
| #1711 | `totalSum` / `total_sum` | `amount` |
| #1712 | `holderAddress` / `holder_address` | `holder` |

These are tracked individually so each rename can be scoped, migrated, and
reviewed on its own rather than bundled into a mass-rename.

### Summary

- 17 of 20 sampled fields conform to the convention.
- 0 casing-drift issues.
- 3 synonym-drift issues, each filed as a separate follow-up (#1710–#1712).
