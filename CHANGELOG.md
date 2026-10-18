# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Tracking

- **#1706 — Claim lifecycle: full end-to-end cross-stack issue group** (umbrella tracking issue, priority: High, layer: All).
  This entry tracks the complete claim lifecycle feature work across all layers. Sub-features are implemented and reviewed in their own linked issues; this umbrella only tracks progress.

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
