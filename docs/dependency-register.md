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
| Contract | `soroban-sdk` | Apache-2.0 | Active, frequent releases (Stellar Development Foundation) | None known |
| Contract | `soroban-token-sdk` | Apache-2.0 | Active | None known |
| Backend | `@nestjs/core` | MIT | Active, regular minor releases | None known |
| Backend | `@stellar/stellar-sdk` | Apache-2.0 | Active | None known |
| Backend | `typeorm` | MIT | Active | None known |
| Backend | `graphql` | MIT | Active | None known |
| Frontend | `next` | MIT | Active, frequent releases (Vercel) | None known |
| Frontend | `react` / `react-dom` | MIT | Active (Meta) | None known |
| Frontend | `@creit.tech/stellar-wallets-kit` | MIT | Active | None known |

CVE status reflects `npm audit` / `cargo audit` results at time of writing;
these tools are the authoritative live source (see
[dependency-update-process.md](./dependency-update-process.md#security-alerts)) — treat the table above as a point-in-time snapshot, not a live feed.

## Review Cadence

This register is reviewed and updated **quarterly**, and additionally
whenever a new critical dependency is introduced to any of the three layers.
The reviewer records the review date below.

| Review date | Reviewer | Notes |
|---|---|---|
| _(none yet — first review pending)_ | | |
