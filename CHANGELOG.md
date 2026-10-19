# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Launch readiness tracking checklist for mainnet (`STELLAR_NETWORK=mainnet`) covering Contract, Backend, Frontend, and Ops items, each with status, owner placeholder, and acceptance criteria. See `docs/launch-readiness-checklist.md`.

### Tracking

- **#1706 — Claim lifecycle: full end-to-end cross-stack issue group** (umbrella tracking issue, priority: High, layer: All).
  This entry tracks the complete claim lifecycle feature work across all layers. Sub-features are implemented and reviewed in their own linked issues; this umbrella only tracks progress.
- Governance umbrella (#1707): DAO voting and delegation cross-stack group.
  Child issues (contract: proposal expiry, rolling claim cap hardening, voter
  snapshot TTL; backend: delegation endpoints, GraphQL escalation mutation;
  frontend: delegation UI, admin voter registration) are tracked under this
  umbrella and carry the `feature:governance` label.  No governance logic is
  changed by the umbrella itself.
- Oracle umbrella (#1708): oracle integration — price feed and fraud scoring
  cross-stack group.  Child issues (contract: sign-then-verify oracle pipeline,
  vet specialization validation; backend: Prometheus treasury gauge from oracle
  data; frontend: network status indicator with oracle feed display) are tracked
  under this umbrella and carry the `feature:oracle` label.  No oracle logic is
  changed by the umbrella itself.

---

  #### Contract
  - Status history log
  - Keeper entrypoints
  - Withdraw claim

  #### Backend
  - Policy expiry keeper
  - Appeal finalize keeper
  - Claim discussion threads

  #### Frontend
  - Discussion thread UI
  - TxStatusDialog

  #### Conventions
  - All linked issues must carry the `feature:claim-lifecycle` label.
  - All linked issues must link back to this umbrella issue (#1706).
