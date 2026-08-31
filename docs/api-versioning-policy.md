# API Versioning Policy

## Overview

This document defines how public surfaces (REST, GraphQL, and contract
entrypoints) are versioned, and how that versioning interacts with removals.

## Versioning Scheme

- REST/GraphQL API: semantic versioning at the service level (`MAJOR.MINOR.PATCH`).
  Breaking changes require a `MAJOR` bump.
- Contract (Soroban): WASM builds are tagged per release; a breaking change to
  a public entrypoint requires a new major contract version.

## Additive (non-breaking) changes

Adding a new REST route, GraphQL field, or contract entrypoint — or adding an
optional request field or a new response field — is **non-breaking** and
requires **no `MAJOR` bump**. Existing clients keep working unchanged because
nothing they already send or read has moved. Such changes ship in a `MINOR`
release and need an entry in [`docs/api/API_CHANGELOG.md`](./api/API_CHANGELOG.md).

A change is only additive if all of the following hold. If any fails, it is a
breaking change and the [Removals](#removals) and deprecation rules apply:

- No existing route, field, or entrypoint is removed or renamed.
- No existing field changes type, nullability, or units.
- No new **required** request field is added to an existing surface.
- Authentication/authorization requirements on existing surfaces are unchanged.
- Error shapes on existing surfaces are unchanged (new error *codes* on a new
  surface are fine; see the error catalog).

## Compliance reviews

Reviews of specific surfaces against this policy are recorded below, so a
reader can see that a surface was assessed rather than assumed compliant.

### Appeal endpoints — additive, no version bump (reviewed 2026-08-28, #1360)

**Verdict: compliant. Additive only; no `MAJOR` bump required.**

Server-side appeal surface as implemented:

| Endpoint | Added in | Assessment |
|---|---|---|
| `POST /api/claims/:id/appeal/build-transaction` | claims controller | New route. Additive. |
| `POST /api/claims/:id/appeal` | claims controller | New route. Additive. |
| `POST /api/admin/claims/:id/finalize-appeal` | admin controller | New admin route. Additive. |
| `open_appeal`, `vote_on_appeal`, `finalize_appeal` | contract entrypoints | New entrypoints. Additive; no new major contract version. |

Checked against the additive criteria above:

- **Nothing removed or renamed.** Every appeal route is a new path segment
  under an existing `claims` resource. No existing claims route changed.
- **No existing field changed type or nullability.** The appeal work added
  `appealsCount` and `appealTxHash` to the `claims` table, but neither is
  surfaced on the existing claim response DTOs — they are returned only by
  `POST /claims/:id/appeal` itself. Existing claim responses are byte-identical.
- **No new required field on an existing surface.** `reason`, `transactionXdr`,
  and `txHash` are required only on the new appeal routes.
- **Auth unchanged on existing surfaces.** The appeal routes carry their own
  `JwtAuthGuard` / admin guard; no existing endpoint's requirements moved.
- **Contract:** `ClaimStatus` gained `UnderAppeal`/`AppealApproved`/
  `AppealRejected` as *appended* discriminants (6–8). Appending variants does
  not renumber existing ones, so the XDR positions clients already decode are
  unchanged. Note `ClaimStatus::Appealed` is retained-but-unused precisely to
  avoid renumbering — see the decision recorded in `contracts/niffyinsure/src/types.rs`.

**Discrepancy worth noting:** the frontend calls two paths that have no backend
route — `GET /api/claims/:id/appeal/status` and `POST /api/claims/:id/appeal/simulate`
(see `frontend/src/lib/api/vote.ts`). They are not part of the reviewed API
surface. If they are implemented later they will also be additive, but until
then they are a client/server mismatch, not a versioning concern.

Since the appeal surface is purely additive, the deprecation process in
[`api-deprecation-policy.md`](./api-deprecation-policy.md) does not apply — it
governs removals only. It becomes relevant if an appeal endpoint is later
withdrawn (90 days' notice for REST, 180 for the contract entrypoints).

## Removals

No public REST/GraphQL field or contract entrypoint may be removed without
first going through the deprecation process, including the minimum notice
period and announcement mechanism, defined in the
[API deprecation policy](./api-deprecation-policy.md). A `MAJOR` version bump
must reference the corresponding deprecation announcement(s) in its changelog
entry.
