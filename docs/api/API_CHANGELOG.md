# Public API Changelog

This changelog is scoped to **external, consumer-facing REST and GraphQL API changes** only:
new endpoints/queries/mutations, field additions or removals, type changes, and deprecations.

It does not cover internal implementation details, contract ABI changes, infra/ops changes,
or anything else that doesn't change what an API consumer sees. For those, see the main
[`CHANGELOG.md`](../../CHANGELOG.md).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## When to add an entry here vs. only in `CHANGELOG.md`

Add an entry to **this file** when a change is visible to an external REST/GraphQL API consumer:

- A new REST route or GraphQL query/mutation/subscription is added.
- A request or response field is added, renamed, removed, or its type/nullability changes.
- An endpoint or field is deprecated or scheduled for removal, including the removal timeline.
- Authentication/authorization requirements change for an existing endpoint.
- Rate limiting, pagination, or error-shape changes that affect how clients must call the API.

Add an entry **only to the internal `CHANGELOG.md`** when the change has no effect on the
public API surface: internal refactors, contract ABI/event changes, database migrations,
infra/deploy changes, dependency bumps, or test-only changes.

If a single change affects both (e.g. an ABI-breaking change that also changes a GraphQL
field type), add entries to **both** files, cross-referencing each other.

## [Unreleased]

### Added
- Claimant appeal endpoints (additive, no version bump — see the compliance
  review in [`docs/api-versioning-policy.md`](../api-versioning-policy.md#appeal-endpoints--additive-no-version-bump-reviewed-2026-08-28-1360)):
  - `POST /api/claims/:id/appeal/build-transaction` — build an unsigned
    `file_appeal` XDR for a rejected claim. Body: `claimant`, `claimId`,
    `reason`. Returns the unsigned XDR plus fee estimates.
  - `POST /api/claims/:id/appeal` — submit the signed appeal transaction.
    Body: `transactionXdr`, `txHash` (idempotency key; a repeat submission with
    the same `txHash` returns the cached result).
  - `POST /api/admin/claims/:id/finalize-appeal` — admin force-finalize of a
    stalled appeal.

### Changed
- Nothing yet.

### Deprecated
- Nothing yet.
