# Dependency Update Review Process

## Overview

Dependencies are updated automatically via Dependabot PRs opened every Monday.
This document defines how those PRs are reviewed and merged.

## SLA

| Severity | Merge deadline |
|---|---|
| Critical / High CVE | 2 business days |
| Moderate CVE | 7 calendar days |
| Routine version bump | 14 calendar days |

## Review Checklist

Before merging any Dependabot PR:

1. CI must be fully green (all jobs pass, including `npm audit` and `cargo audit`).
2. Check the changelog / release notes linked in the PR for breaking changes.
3. For major version bumps, manually test the affected feature area locally.
4. For `@stellar/stellar-sdk` or `@creit.tech/stellar-wallets-kit` bumps, run the
   golden-vector job locally (`npm run refresh-vectors`) and review any diff.
5. For Cargo bumps touching `contracts/`, rebuild the WASM and verify the ABI
   golden vectors are unchanged.

## Security Alerts

`npm audit` and `cargo audit` run on every CI push/PR and fail on `high` or
`critical` severity findings. If a vulnerability is detected:

1. Check whether a patched version is available. If yes, update immediately.
2. If no patch exists, open a tracking issue tagged `security` and document the
   accepted risk with an expiry date (max 30 days).
3. Never merge a PR that introduces a new high/critical vulnerability.

## Pinned GitHub Actions

All GitHub Actions are pinned to full commit SHAs (with the tag noted in a
comment). When Dependabot opens a PR to update an action, verify the new SHA
corresponds to the expected tag before merging.

## Tooling

- **Dependabot** — automated PRs for npm (frontend & backend), Cargo, and
  GitHub Actions. Config: `.github/dependabot.yml`.
- **npm audit** — runs in `frontend` and `unit-tests` CI jobs.
- **cargo audit** — runs in the `contract` CI job via `cargo-audit`.
