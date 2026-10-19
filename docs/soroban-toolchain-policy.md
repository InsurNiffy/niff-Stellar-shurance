# Soroban SDK Toolchain Matrix Policy

## What runs

`contracts-ci.yml` runs `cargo test --workspace --features testutils`
against two `soroban-sdk` versions on every PR touching `contracts/**`:

- **`pinned`** — the exact version pinned in
  `contracts/*/Cargo.toml` (currently `=25.3.1`). A failure here
  **blocks the build**; this is the version developers build against
  and it must always be green.
- **`latest`** — the pin is relaxed and `cargo update -p soroban-sdk`
  pulls the newest published release before running the same test
  suite. This leg runs with `continue-on-error: true`, so a failure is
  surfaced in the Actions UI (the job shows as failed/yellow) but does
  **not** block merging.

## When to bump the pinned version

1. If `latest` starts failing, treat it as an early warning, not an
   emergency — nothing blocks. Open (or update) a tracking issue
   describing what broke.
2. Do **not** bump the pin the moment a new soroban-sdk version ships.
   Wait until:
   - the `latest` matrix leg has been green for the new version across
     at least a few CI runs, and
   - the release notes/changelog for the new version have been
     reviewed for breaking changes relevant to this codebase.
3. When ready, bump the version in both `contracts/niffyinsure/Cargo.toml`
   and `contracts/premium_calculator/Cargo.toml`, run `cargo update -p
   soroban-sdk`, commit the updated `Cargo.lock`, and open a normal PR —
   the `pinned` leg of the matrix now tests the new version directly.
4. If `latest` fails and investigation shows the break is a real bug in
   the upstream SDK (not a codebase issue), do **not** bump the pin;
   keep pinned on the last known-good version until a fix ships
   upstream.

## stellar-cli toolchain policy

The `soroban-sdk` pin above governs the contract crate dependencies.
The `stellar-cli` binary used to build, deploy, and invoke those
contracts is versioned separately and is pinned independently.

### Current pin

The pinned `stellar-cli` version is recorded in `CONTRIBUTING.md`
(see the "Soroban toolchain" section) and is checked as a prerequisite
by the `Makefile` (`make check-toolchain`). The current pin is
`stellar-cli 22.0.1`.

### Compatible version range

- **Supported:** `>=22.0.0, <23.0.0` — the pinned minor line. Patch
  releases within this range are safe to adopt without a policy
  change.
- **Unsupported:** any `stellar-cli` outside that range. A major bump
  (e.g. `23.x`) may change CLI flags, output formats, or the embedded
  Soroban environment and must go through the upgrade procedure below.

### Upgrade procedure

1. Read the `stellar-cli` release notes for the target version and
   check for breaking changes to the commands this repo uses
   (`contract build`, `contract deploy`, `contract invoke`).
2. Bump the pinned version in `CONTRIBUTING.md` and in the `Makefile`
   prerequisite check so both stay in sync.
3. Run `make check-toolchain` locally to confirm the new binary is
   detected, then run the contract test suite against it.
4. Open a normal PR. The `pinned` leg of the CI matrix must stay green
   with the new CLI before merging.
5. If the new CLI breaks the build and the cause is an upstream bug,
   do **not** bump the pin; keep the last known-good version until a
   fix ships upstream.
