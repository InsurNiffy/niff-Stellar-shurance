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

## Audit follow-up

An audit of a sample of existing events/columns/fields against this
convention should be tracked as a separate task, with any significant
inconsistencies filed as individual follow-up issues rather than fixed via
mass-rename here.
