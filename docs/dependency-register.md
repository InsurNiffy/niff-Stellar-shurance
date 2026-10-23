# Critical Dependency Register

## Overview

Single source of truth for license, maintenance activity, and known-CVE
status of the critical dependencies used across the contract, backend, and
frontend layers. Complements the process defined in
[dependency-update-process.md](./dependency-update-process.md), which covers
how Dependabot PRs for these (and other) dependencies get reviewed.

## Register

| Layer | Dependency | License | Maintenance activity | Known CVE status (as of this review) |
|---|---|---|---|---|
| Contract | `soroban-sdk` | Apache-2.0 | Active, frequent releases (Stellar Development Foundation) | Not re-verified 2026-10-22 — `cargo audit` pending (runs in CI) |
| Contract | `soroban-token-sdk` | Apache-2.0 | Active | Not re-verified 2026-10-22 — `cargo audit` pending (runs in CI) |
| Backend | `@nestjs/core` | MIT | Active, regular minor releases | Not verified 2026-10-22 — `backend/package-lock.json` is invalid JSON, `npm audit` fails (ENOLOCK) |
| Backend | `@stellar/stellar-sdk` | Apache-2.0 | Active | Not verified 2026-10-22 — see `@nestjs/core` row |
| Backend | `typeorm` | MIT | Active | Not verified 2026-10-22 — see `@nestjs/core` row |
| Backend | `graphql` | MIT | Active | Not verified 2026-10-22 — see `@nestjs/core` row |
| Frontend | `next` | MIT | Active, frequent releases (Vercel) | **Critical** — DoS via Server Components, middleware bypass, redirect cache poisoning (affects ≤ 16.3.7); fix available via upgrade |
| Frontend | `react` / `react-dom` | MIT | Active (Meta) | None known |
| Frontend | `@creit.tech/stellar-wallets-kit` | MIT | Active | **High** (transitive: `@hot-wallet/sdk`, `@trezor/connect-web`, `@stellar/stellar-sdk` → `toml`); fix requires semver-major change |

CVE status reflects `npm audit` / `cargo audit` results at time of writing;
these tools are the authoritative live source (see
[dependency-update-process.md](./dependency-update-process.md#security-alerts)) — treat the table above as a point-in-time snapshot, not a live feed.

## Review Cadence

This register is reviewed and updated **quarterly**, and additionally
whenever a new critical dependency is introduced to any of the three layers.
The reviewer records the review date below.

| Review date | Reviewer | Notes |
|---|---|---|
| 2026-10-22 | @jones43r | First quarterly review. `frontend` npm audit: 106 vulns (5 critical, 64 high). Backend npm audit blocked by invalid lockfile; `cargo audit` not run locally (no toolchain) — follow up in CI. |

**Next review due:** Q1 2027 — reviewer to schedule a calendar reminder for 2027-01-15.
