# Feature Flag Naming Convention & Lifecycle

Feature flags are used on both the backend
([`ALLOWED_FLAG_KEYS`](../backend/src/feature-flags/feature-flags.service.ts)) and the frontend
([`useFeatureFlag`](../frontend/src/hooks/use-feature-flag.ts)), keyed off the same string. This
doc defines a shared naming convention and lifecycle so a flag can be correlated across the
stack and it's clear when it's safe to remove.

See also: [`docs/feature-flags.md`](./feature-flags.md) (usage/API) and
[`backend/docs/feature-flags.md`](../backend/docs/feature-flags.md) (backend implementation).

## Naming convention

`<area>_<capability>_enabled` (or `<area>_<capability>_<lifecycle-suffix>` — see below), all
lowercase snake_case, area-prefixed so the flag's owning domain is obvious without opening the
allowlist:

| Prefix | Area |
|---|---|
| `claims_` | Claims submission/processing |
| `policy_` | Policy creation/lifecycle |
| `voting_` | Governance/voting |
| `ramp_` | Fiat on/off-ramp |
| `graphql_` | GraphQL API surface |
| `tenant_` | Multi-tenant resolution/config |
| `ipfs_` | IPFS storage integration |
| `quote_` | Quote/pricing simulation |
| `admin_` / `dev_` | Internal/admin/dev tooling only, never user-facing |

Flags that gate a whole subsystem rather than a single capability (e.g. `maintenance_mode`) are
the one accepted exception to the `_enabled` suffix — keep them rare and self-explanatory.

The **same key** must be used verbatim on both backend and frontend — the frontend must not
invent its own name for a flag the backend also gates.

## Lifecycle stages

Track a flag's stage in its `description` field (stored alongside the flag) using one of these
tags as a prefix, e.g. `description: "[experimental] ..."`:

1. **`experimental`** — newly added, off by default, behavior may still change. Owner must be
   named in the description.
2. **`rolled-out`** — enabled in production for all tenants/users; kept only to allow a fast
   kill-switch. Candidate for removal once confidence is high enough that the kill-switch is no
   longer needed.
3. **`deprecated`** — scheduled for removal; the code path it guards is being deleted. Include
   a target removal date/PR in the description. Once the guarded code is deleted, delete the
   flag from `ALLOWED_FLAG_KEYS` and the database.

A flag should never stay in `rolled-out` indefinitely without a periodic look — that's what the
cleanup audit (below) is for.

## Audit of existing flags (dry-run against current allowlist)

Audited against `ALLOWED_FLAG_KEYS` in
[`backend/src/feature-flags/feature-flags.service.ts`](../backend/src/feature-flags/feature-flags.service.ts):

| Flag | Matches area prefix convention? | Suggested lifecycle stage |
|---|---|---|
| `claims_enabled` | Yes (`claims_`) | rolled-out |
| `claims_appeal_enabled` | Yes (`claims_`) | experimental |
| `policy_creation_enabled` | Yes (`policy_`) | rolled-out |
| `voting_enabled` | Yes (`voting_`) | rolled-out |
| `ramp_enabled` | Yes (`ramp_`) | rolled-out |
| `graphql_enabled` | Yes (`graphql_`) | rolled-out |
| `tenant_resolution` | Yes (`tenant_`), missing `_enabled` suffix | rolled-out |
| `maintenance_mode` | Accepted exception (subsystem-wide switch) | rolled-out |
| `ipfs_upload_enabled` | Yes (`ipfs_`) | rolled-out |
| `quote_simulation_cache_enabled` | Yes (`quote_`) | experimental |
| `experimental_beta_calculators` | No — uses `experimental_` as an area prefix instead of a lifecycle tag; should become e.g. `quote_beta_calculators_enabled` with `[experimental]` in its description | experimental |
| `ENABLE_DEV_TOOLS` | No — wrong case (SCREAMING_SNAKE_CASE) and no area prefix; should become `dev_tools_enabled` | rolled-out (dev-only) |

`claims_appeal_enabled` gates the claimant appeal flow end-to-end: the appeal
endpoints (`POST /claims/:id/appeal/build-transaction` and `POST /claims/:id/appeal`,
via `@Feature`) and the `AppealButton` in the claim vote panel (via `useFeatureFlag`).
Owner: claims. Off by default — enable per environment to stage the rollout.

**Findings:** 10 of 12 existing flags already fit the convention. `experimental_beta_calculators`
and `ENABLE_DEV_TOOLS` are the two non-conforming names; rename them the next time either flag
is touched (renaming now would require a coordinated backend+frontend+DB migration, which is out
of scope for this documentation pass).

This convention is referenced from the feature flag cleanup audit process — see
[`docs/feature-flags.md`](./feature-flags.md#cleanup-audits).
