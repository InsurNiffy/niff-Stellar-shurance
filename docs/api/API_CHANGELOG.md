# API Changelog

All notable changes to the public API are documented here. This changelog follows the
[API versioning policy](./api-versioning-policy.md).

## Unreleased

### Added

- `POST /api/claims/:id/appeal/build-transaction` — Build an unsigned transaction for
  filing an appeal on a claim.
- `POST /api/claims/:id/appeal` — Submit a signed appeal transaction for a claim.
- `POST /admin/claims/:id/finalize-appeal` — Admin endpoint to finalize an appeal on a
  claim.

These are additive changes per the additive change policy (reviewed 2026-08-28, #1360).
No MAJOR version bump is required.
