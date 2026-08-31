# Changelog

All notable changes to NiffyInsure are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## ABI-BREAKING Convention

Changes that break the on-chain contract interface or event schema are tagged:

- **[ABI-BREAKING: entrypoint]** — a contract entrypoint was added, removed, or its
  argument/return types changed in a backwards-incompatible way.  Indexers and SDK
  clients must be updated before deploying this version.
- **[ABI-BREAKING: event]** — an event topic or data schema changed.  All indexer
  pipelines that consume this event must be migrated before the contract upgrade.
- **[ABI-BREAKING: storage]** — an on-chain storage key layout changed.  A migration
  entry-point or a ledger migration script is required.

Any release that carries one or more ABI-BREAKING tags requires:
1. A coordinated indexer migration window.
2. An updated `contracts/deployment-registry.json` entry with the new contract hash.
3. A companion migration guide under `docs/migrations/<version>.md`.

---

## [Unreleased]

### Added
- Admin governance UI: voters, region, quorum, and dispute panels (#1006).
- UI improvements across four tracked issues (#1005).
- Contract fuzz testing harness for `niffyinsure` and `premium_calculator` (#1003).

---

## [0.4.0] — 2026-06-01

### Added
- Rolling claim cap enforced on-chain (`rolling_claim_cap.rs`).
- Commit-reveal scheme for governance vote privacy (`commit_reveal.rs`).
- Delegation support for governance tokens (`delegation.rs`).
- Premium calculator as a standalone contract (`premium_calculator/`).
- Oracle integration for parametric trigger data (`oracle.rs`).

### Changed
- **[ABI-BREAKING: entrypoint]** `submit_claim` now requires a `proof_hash: BytesN<32>`
  argument.  Callers and the backend claim-submission flow must be updated.
- **[ABI-BREAKING: event]** `ClaimSubmitted` event gains a `proof_hash` topic field;
  all indexers filtering on this event must add the new topic to their decoders.
- Policy lifecycle split into `policy_lifecycle.rs`; `init_policy` entrypoint
  signature unchanged.

### Fixed
- Premium calculation overflow for policies with very high coverage limits.
- Governance quorum check off-by-one when voter count equals quorum threshold.

---

## [0.3.0] — 2026-03-15

### Added
- Governance token contract (`governance_token.rs`).
- Admin module for parameter management (`admin.rs`).
- Storybook component library integration.
- Playwright end-to-end test suite (claim filing, wallet connect, policy initiation).

### Changed
- **[ABI-BREAKING: entrypoint]** `cast_vote` replaced by `vote_on_claim(claim_id,
  vote: VoteChoice)`.  All governance UIs and SDK wrappers must migrate.
- **[ABI-BREAKING: storage]** Governance proposal storage key changed from
  `DataKey::Proposal(u32)` to `DataKey::Proposal(BytesN<32>)`.  Deploy with the
  provided migration script `scripts/migrate-proposals-v3.sh`.

### Removed
- Legacy `approve_claim` entrypoint (superseded by `vote_on_claim`).

---

## [0.2.0] — 2025-12-10

### Added
- Redis-backed claim notification service in the backend.
- OpenTelemetry tracing (`backend/src/tracing.ts`).
- Load test scenarios (k6) for claim submit and GraphQL policy queries.
- `EVENT_DICTIONARY.md` documenting all on-chain events.

### Changed
- **[ABI-BREAKING: event]** `PolicyActivated` now emits `premium_paid: i128` in
  addition to `policy_id`.  Indexers must handle the additional data field.
- Docker Compose dev stack updated to Redis 7 Alpine.

### Fixed
- Wallet session timeout not resetting on activity.
- Missing ARIA labels on claim status badges.

---

## [0.1.0] — 2025-09-01

### Added
- Initial NiffyInsure monorepo: Soroban smart contracts, NestJS backend, Next.js
  frontend.
- Core contracts: `niffyinsure` (policy, claim, governance), `premium_calculator`.
- CI pipelines: frontend, backend, contracts, fuzz.
- `CONTRIBUTING.md`, `SECURITY.md`, `audit.toml`.

[Unreleased]: https://github.com/InsurNiffy/niff-Stellar-shurance/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/InsurNiffy/niff-Stellar-shurance/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/InsurNiffy/niff-Stellar-shurance/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/InsurNiffy/niff-Stellar-shurance/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/InsurNiffy/niff-Stellar-shurance/releases/tag/v0.1.0
