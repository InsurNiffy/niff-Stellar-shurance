# Soroban SDK Upgrade Checklist

> **Issue #778** — Tracks the upgrade path for `soroban-sdk` across the contract
> codebase so breaking changes are caught before they reach production.

---

## Current pinned version

| Crate | Pinned version | File |
|---|---|---|
| `soroban-sdk` (contract) | `=25.3.1` | `contracts/niffyinsure/Cargo.toml` |
| `soroban-sdk` (dev) | `=25.3.1` | `contracts/niffyinsure/Cargo.toml` |
| `ed25519-dalek` | `=2.1.1` | `contracts/niffyinsure/Cargo.toml` |
| `rand` | `=0.8.5` | `contracts/niffyinsure/Cargo.toml` |

---

## Compatibility matrix

| SDK version | Status | Known breaking changes |
|---|---|---|
| `21.x` | EOL | `contracttype` derive macro API changed |
| `22.x` | EOL | Auth API refactor (`require_auth` signature) |
| `22.x` | EOL | MSRV bumped to Rust 1.81 |
| `23.x` | EOL | `contractevent` topic ordering changed |
| `24.x` | EOL | `contracterror` discriminant validation tightened |
| `25.3.1` | **Current (pinned)** | — |
| `26.x` | Not yet tested | Monitor release notes |

---

## Pre-upgrade checklist

Complete every step in order before merging a version bump PR.

### 1. Preparation
- [ ] Open a dedicated upgrade ticket referencing this document and the target SDK version.
- [ ] Record the current pinned version and the target version.
- [ ] Read the [soroban-sdk CHANGELOG](https://github.com/stellar/rs-soroban-sdk/blob/main/CHANGELOG.md) and note all breaking changes between the two versions.
- [ ] Update this compatibility matrix with any new breaking changes found.

### 2. Cargo.toml update
- [ ] Change the pinned version in `contracts/niffyinsure/Cargo.toml` (`[dependencies]` and `[dev-dependencies]`).
- [ ] Run `cargo update -p soroban-sdk` to refresh `Cargo.lock`.
- [ ] Confirm no other transitive dependency pins conflict.

### 3. Compile
- [ ] `cargo build --release` — zero errors and zero warnings (treat warnings as errors on CI).
- [ ] `cargo build --features testutils` — same standard.
- [ ] Check for deprecation warnings; address before merge.

### 4. Unit tests
- [ ] `cargo test` — all tests pass with no ignored failures.
- [ ] `cargo test --features testutils` — same.
- [ ] If any test is newly skipped or `#[ignore]`-tagged, document why in the PR.

### 5. Integration / simulation
- [ ] Run the full test suite against Stellar testnet using the upgraded WASM.
- [ ] Execute the smoke-test matrix defined in `Makefile` (`make test-integration`).
- [ ] Verify contract entrypoints via Stellar CLI: `initialize`, `initiate_policy`, `file_claim`, `finalize_claim`.

### 6. Storage / XDR compatibility
- [ ] Confirm no `#[contracttype]` struct or enum field order changed (XDR-breaking).
- [ ] If the `DataKey` enum discriminant layout changed, audit every existing persistent entry for silent collision (see `docs/storage-keys.md`).
- [ ] Run the `storage_key_uniqueness` test to confirm no collision was introduced.

### 7. Auth and error codes
- [ ] Verify all `contracterror` discriminant values are unchanged.
- [ ] Confirm `require_auth` / `require_auth_for_args` call sites still compile without changes.

### 8. Sign-off
- [ ] PR author self-review against this checklist (check every box above).
- [ ] Second reviewer sign-off.
- [ ] Merge only after CI is green on both pinned and next-minor SDK jobs.

---

## Rollback procedure

If an upgrade causes a production regression:

1. Revert `Cargo.toml` to the previous pinned version and open a hotfix PR.
2. Run `cargo update -p soroban-sdk` to restore the old `Cargo.lock` entries.
3. Re-run the full unit and integration test suite.
4. Deploy the rolled-back WASM via the standard deployment pipeline.
5. File a follow-up ticket to investigate the regression before retrying the upgrade.

---

## CI jobs

| Job | Trigger | Purpose |
|---|---|---|
| `test (pinned)` | Every PR | Tests against the current pinned SDK version |
| `test (next-minor)` | Scheduled (weekly) | Early warning for the next SDK minor release |

Add the scheduled job to `.github/workflows/sdk-compat.yml` when the next minor version is available.
