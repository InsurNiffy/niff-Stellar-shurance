# niffyInsure — Rebuild From Scratch: Issue Backlog

This backlog rebuilds niffyInsure from an empty `src/` in all three layers:

| Layer | Path | Issues |
|---|---|---|
| Contract | `contracts/niffyinsure/src`, `contracts/premium_calculator/src` | 35 (`C-01` – `C-35`) |
| Backend | `backend/src` (NestJS 11, Prisma, BullMQ, Redis) | 45 (`B-01` – `B-45`) |
| Frontend | `frontend/src` (Next.js App Router, React 19, Tailwind, React Query) | 45 (`F-01` – `F-45`) |

**Total: 125 issues.**

## How to use this backlog

- **Every issue is independent.** No issue depends on another, and any issue can be picked up in any order. Each one names the files it owns and describes the behaviour it needs from the rest of the system, instead of pointing at other issues.
- If an issue needs a piece that does not exist yet (a type, a helper, a module), create the smallest version of it inside that issue's own scope, and note it in the PR so it can be reconciled.
- Configuration, tooling and tests outside `src/` were kept (Cargo manifests, `package.json`, `tsconfig`, Prisma schema and migrations, Dockerfiles, existing `tests/`, `test/`, `e2e/`). Treat them as **reference, not truth**. An issue that touches them must say so explicitly and justify each change.
- The previous implementation is still in git history (`git show 5220f84:<path>`). You may read it for intent, but do **not** copy it wholesale. Each issue must be rebuilt, reviewed and tested on its own merits.
- One issue = one PR. PRs must not include unrelated changes.

## Definition of done (applies to every issue)

- Code compiles with zero warnings in its layer (`cargo clippy -- -D warnings`, `npm run lint`, `npm run typecheck`).
- New behaviour is covered by tests. Bug-prone paths (arithmetic, auth, state transitions) need negative tests, not only happy paths.
- Public interfaces (contract entrypoints, REST/GraphQL endpoints, exported components) are documented where they are defined.
- No secrets, private keys or real user data are committed.
- CI is green.

## Labels

`contract`, `backend`, `frontend`, `foundation`, `security`, `testing`, `devops`, `ux`, `a11y`, `performance`, `docs`, `good-first-issue`, `complex`

---

# Contract (C-01 – C-35)

## C-01 Contract — Scaffold the `niffyinsure` crate, module layout and build pipeline

**Labels:** `contract`, `foundation`, `devops`

### Description

`contracts/niffyinsure/src` is empty. Before any business logic lands, the crate needs a compiling skeleton: a `#![no_std]` `lib.rs` with an empty `#[contract]`, the module files the rest of the contract will live in, and a reproducible WASM build. This issue sets the conventions for the whole contract codebase, including module boundaries, feature flags, lint level and build commands, so they must be deliberate and documented.

### Tasks

- Create `src/lib.rs` with `#![no_std]`, an empty `NiffyInsure` contract struct and `#[contractimpl]` block.
- Create empty module files with a one-line doc comment describing ownership: `types`, `storage`, `validate`, `events`, `admin`, `token`, `premium_pure`, `premium`, `calculator`, `policy`, `policy_lifecycle`, `claim`, `ledger`, `rolling_claim_cap`, `commit_reveal`, `delegation`, `governance`, `oracle`.
- Review `Cargo.toml` features (`testutils`, `experimental`, `legacy-event-schema-tests`, `governance-token`, `appeal-stub`). Keep only the features this rebuild will use, and document each one.
- Confirm `soroban-sdk = "=25.3.1"` builds on the MSRV in `Cargo.toml`, and that release profile settings (`opt-level = "z"`, `lto`, `panic = "abort"`, `overflow-checks = true`) are set in the workspace `Cargo.toml`.
- Add/verify `make contract-build` and `make contract-test` targets in the root `Makefile` producing an optimized `.wasm`.
- Add a `tests/common/mod.rs` harness with a `setup()` helper returning `(Env, ContractClient, admin, token)` that any test file can reuse.

### Additional Requirements

- `overflow-checks = true` must be on in release. All contract arithmetic relies on it as a safety net.
- Do not re-enable old test files in `tests/` yet. Gate them out of the build so the crate compiles cleanly.

### Acceptance Criteria

- `cargo build --target wasm32v1-none --release -p niffyinsure` succeeds with zero warnings.
- `cargo clippy -p niffyinsure -- -D warnings` passes.
- `cargo test -p niffyinsure` runs (with zero or trivial tests) and passes.
- README section documents build, test and feature flags.

---

## C-02 Contract — Error enums with stable, documented discriminants

**Labels:** `contract`, `foundation`

### Description

Every entrypoint returns typed errors. The backend error catalog and the frontend map these numeric codes to user-facing messages, so the discriminants are a **public ABI**. Once a code is released, it must never be renumbered. This issue defines the error enums and the numbering rules, so new variants can be added later without reshuffling existing ones.

### Tasks

- In `validate.rs`, define `#[contracterror] #[repr(u32)] pub enum Error` for claim/policy/validation failures, and in `admin.rs` an `AdminError` enum. Keep a separate `InitError` for `initialize`.
- Reserve numeric ranges per domain (e.g. 1–99 init/admin, 100–199 policy, 200–299 claim, 300–399 voting, 400–499 treasury) and document the ranges in a module comment.
- Add a unit test that asserts each variant's discriminant literally (`assert_eq!(Error::ClaimNotFound as u32, 201)`) so accidental renumbering fails CI.
- Export a machine-readable list (a `const` table or a generated JSON via a test) that the backend can consume.

### Additional Requirements

- Soroban limits the number of variants per `contracterror` enum. Document the limit and the plan for when a domain outgrows its enum.
- No `panic!` for expected user errors anywhere in the contract. Panics are reserved for invariant violations.

### Acceptance Criteria

- Discriminant-pinning test exists and passes.
- Numeric ranges and the "never renumber" rule are documented in `validate.rs`.
- A JSON/TS-friendly error list can be generated for the backend.

---

## C-03 Contract — Core domain types: policy, claim, risk and status enums

**Labels:** `contract`, `foundation`

### Description

Define the `#[contracttype]` data model that every other module uses: `PolicyType`, `RegionTier`, `AgeBand`, `CoverageTier`, `RiskInput`, `Policy`, `Claim`, `ClaimStatus`, `VoteOption`, `ClaimEvidenceEntry`, `PauseReason`, `TerminationReason`, `ContractMetadata`. Getting this shape right early avoids storage migrations later.

### Tasks

- Implement all types in `types.rs` with doc comments on every field (units, asset denomination, ledger vs. timestamp).
- `ClaimStatus` uses explicit `#[repr(u32)]` discriminants and a documented state-transition diagram (Processing → Approved/Rejected/Withdrawn, Approved → Paid/PayoutTimeout/Disputed, Rejected → UnderAppeal → AppealApproved/AppealRejected).
- `Policy` includes `holder`, `policy_id`, `policy_type`, `region`, `premium`, `coverage`, `is_active`, `start_ledger`, `end_ledger`, `asset`, `deductible`, `beneficiary`, `metadata_uri`, `terms_hash`, `strike_count`.
- `InitiatePolicyOptions` struct bundles optional bind inputs to stay under Soroban's 10-parameter limit.
- Define `PAGE_SIZE_MAX` and pagination summary types (`PolicySummary`, `ClaimSummary`).
- Add a `ClaimStatus::can_transition_to(next)` helper with an exhaustive unit test matrix.

### Additional Requirements

- All monetary fields are `i128` in the asset's smallest unit (stroops for 7-decimal assets). Never use floats.
- Do not add reserved or "future" variants unless a concrete issue in this backlog needs them.

### Acceptance Criteria

- Types compile to the contract spec and round-trip through `IntoVal`/`TryFromVal` in tests.
- The transition-matrix test covers every `(from, to)` pair.
- Field-level docs explain units and invariants.

---

## C-04 Contract — Storage layer with explicit TTL strategy

**Labels:** `contract`, `foundation`, `complex`

### Description

Soroban storage has three tiers (instance, persistent, temporary), each with different costs and expiry semantics. Choosing the wrong tier or forgetting to extend a TTL causes archived entries and bricked policies. `storage.rs` must be the **only** module that touches `env.storage()`, exposing typed getters and setters.

### Tasks

- Define a single `DataKey` enum covering config (instance), policies/claims/votes (persistent), and short-lived nonces/locks (temporary).
- Implement typed accessors (`get_policy`, `set_policy`, `get_claim`, `next_claim_id`, etc.) that bump TTL on every write, and on reads where the entry is hot.
- Centralize TTL constants (`INSTANCE_BUMP`, `PERSISTENT_BUMP`, thresholds) with a comment deriving them from ledger close time.
- Expose `bump_policy_ttl`, `bump_holder_all_policies_ttl`, `bump_claim_ttl`, `get_policy_ttl_info`, `get_claim_ttl_info`, `is_policy_ttl_near_expiry`, `set_ttl_alert_threshold` entrypoints.
- Add a lint-style test (grep in a build script or unit test) asserting no module other than `storage.rs` calls `env.storage()`.

### Additional Requirements

- Per-holder policy lists must be bounded or paginated. Unbounded `Vec` growth in a single entry is not allowed.
- Document which keys are instance-tier. Instance storage is loaded on every call, so keep it small.

### Acceptance Criteria

- Tests advance the ledger past TTL thresholds and prove bumped entries survive while unbumped temporary entries expire.
- No direct `env.storage()` calls outside `storage.rs`.
- TTL constants and their rationale are documented.

---

## C-05 Contract — `initialize`, admin storage and metadata entrypoints

**Labels:** `contract`, `foundation`, `security`

### Description

The contract needs a one-time `initialize(admin, token)` that sets the admin and the default treasury asset, plus read-only metadata used by the backend and deploy tooling: `get_admin`, `version`, `get_contract_metadata`, `get_wasm_hash`.

### Tasks

- Implement `initialize`, returning `InitError::AlreadyInitialized` on a second call.
- Require `admin.require_auth()` during initialize so a front-running deployer cannot claim admin.
- Implement `version()` from `CARGO_PKG_VERSION`, and `get_contract_metadata()` returning version, admin, token and init ledger.
- Add a `require_admin(env)` helper in `admin.rs` used by every privileged entrypoint.
- Tests: double init, uninitialized calls to privileged entrypoints, metadata correctness.

### Additional Requirements

- Every entrypoint except `initialize` and pure reads must fail cleanly with a typed error if the contract is not initialized.

### Acceptance Criteria

- Re-initialization is impossible.
- Uninitialized access returns a typed error, never a panic trace.
- Metadata entrypoints return correct values in tests.

---

## C-06 Contract — Two-step admin rotation with events

**Labels:** `contract`, `security`

### Description

Transferring admin in a single call risks sending control to a typo'd address forever. Implement `propose_admin(new_admin)` (current admin) and `accept_admin()` (pending admin), plus `cancel_admin_proposal`. Each step emits an event.

### Tasks

- Store the pending admin in instance storage, with an optional expiry ledger.
- `accept_admin` requires `pending.require_auth()`, then swaps the admin and clears pending.
- Emit `AdminProposed`, `AdminRotated` and `AdminProposalCancelled` events.
- Tests: wrong caller accepts, expired proposal, proposal overwritten, old admin loses rights immediately.

### Additional Requirements

- The current admin keeps full rights until `accept_admin` succeeds.

### Acceptance Criteria

- All rotation paths are tested, including the negative ones.
- Events are emitted with the documented topic layout.

---

## C-07 Contract — Granular pause controls (global, bind, claims)

**Labels:** `contract`, `security`

### Description

Incident response needs to stop new risk without freezing everything. Implement `pause(admin, reason)`, `unpause(admin)`, `pause_bind(admin, reason)` and `pause_claims(admin, reason)`, with read helpers `is_paused`, `get_pause_flags` and `get_pause_reason`.

### Tasks

- Store `PauseFlags { global, bind, claims }` and `PauseReason`.
- Add `assert_not_paused(env, Scope)` guards and call them from bind, claim filing, voting and payout entrypoints and wire it into every existing entrypoint in those groups.
- Define precisely which operations stay available during a global pause. At minimum, reads and `withdraw_claim` stay available so users are not trapped.
- Emit `Paused` and `Unpaused` events that include the scope and reason.

### Additional Requirements

- Document the pause matrix (operation × flag) in the module docs.

### Acceptance Criteria

- The matrix is enforced by tests, with one test per cell that matters.
- Unpausing restores all functionality.

---

## C-08 Contract — Asset allowlist, decimals and per-asset claim bounds

**Labels:** `contract`, `security`

### Description

Policies may be denominated in several SEP-41 assets (e.g. XLM SAC, USDC). Only admin-approved assets may be used for premiums and payouts. Each asset has known decimals and min/max claim bounds.

### Tasks

- Implement `set_allowed_asset(asset, allowed)`, `is_allowed_asset`, `admin_set_asset_decimals`, `get_asset_decimals`, `admin_set_asset_claim_bounds` and `get_asset_claim_bounds`.
- Validate that bounds are positive and `min <= max`.
- Emit `AssetAllowlistUpdated` events.
- Tests: bind or file against a non-allowlisted asset fails, bounds enforced, delisting an asset does not break existing policies (document the chosen behaviour).

### Additional Requirements

- Decide and document what happens to active policies when their asset is delisted, e.g. whether claims can still be paid.

### Acceptance Criteria

- Allowlist enforced at every entrypoint that accepts an asset.
- Delisting behaviour documented and tested.

---

## C-09 Contract — SEP-41 token helpers and internal ledger accounting

**Labels:** `contract`, `security`, `complex`

### Description

All token movement goes through `token.rs`, and internal balances are tracked in `ledger.rs`. The contract must never assume its token balance equals its liabilities. Track premiums collected, reserved coverage and paid claims explicitly so solvency checks are meaningful.

### Tasks

- `token.rs`: `transfer_in(from, asset, amount)` and `transfer_out(to, asset, amount)` wrappers using `soroban_sdk::token::Client`, validating `amount > 0`.
- `ledger.rs`: per-asset counters for `treasury_balance`, `reserved_coverage`, `total_premiums` and `total_paid`, updated with checked arithmetic.
- Apply the checks-effects-interactions ordering. Update internal state before the external transfer, and document why re-entrancy is limited on Soroban but ordering still matters.
- `get_treasury_balance(asset)` read entrypoint.

### Additional Requirements

- Every arithmetic operation uses `checked_*` and returns a typed error on overflow.

### Acceptance Criteria

- Unit tests prove the counters stay consistent across premium in, payout out and refund.
- There is an invariant test: `token balance >= treasury_balance` after arbitrary operation sequences.

---

## C-10 Contract — Treasury deposits, authorized depositors and sweep limits

**Labels:** `contract`, `security`

### Description

The treasury must be funded (capital providers, reinsurance) and occasionally swept. Only authorized depositors may call `deposit_treasury`. Admin sweeps are rate-limited per ledger to cap damage from a compromised admin key.

### Tasks

- Implement `set_authorized_depositor`, `is_authorized_depositor`, `deposit_treasury(depositor, asset, amount)`.
- Implement `admin_sweep(asset, to, amount)` limited by `admin_set_max_sweep_per_ledger` / `get_max_sweep_per_ledger`, and never below `reserved_coverage`.
- Implement `set_allowed_payout_recipient` / `is_allowed_payout_recipient` for sweep destinations.
- Emit `TreasuryDeposited` and `TreasurySwept` events.

### Additional Requirements

- A sweep that would leave the treasury under-reserved must fail, regardless of the cap.

### Acceptance Criteria

- Tests cover unauthorized deposit, cap exceeded, under-reserve sweep and a valid sweep.

---

## C-11 Contract — Pure premium engine with golden vectors

**Labels:** `contract`, `complex`

### Description

`premium_pure.rs` computes premiums from `RiskInput` (region, age band, coverage tier, safety score) and a `MultiplierTable`, with **no** storage or env access. This makes it deterministic and testable, and lets the backend verify parity using golden vectors.

### Tasks

- Define `MultiplierTable` (basis-point multipliers per region, age band and coverage tier, plus a safety-score discount curve).
- Implement `compute_premium(input, table, base) -> Result<i128, Error>` using fixed-point integer math and documented rounding (round half up, or banker's, but pick one and document it).
- Validate table bounds (e.g. each multiplier within 0.5x–5x) in `validate_table`.
- Generate `golden-vectors.json` (inputs → expected premium) from a test, and commit it for the backend to consume.
- Property tests: monotonicity (higher risk never cheaper), no overflow at max inputs, zero or negative never returned.

### Additional Requirements

- The function must be usable from both `niffyinsure` and `premium_calculator` without duplication. Consider a small shared crate or `#[path]` include, and document the choice.

### Acceptance Criteria

- Golden vectors are generated and committed. The test fails if output drifts.
- Property tests pass for 10k+ random inputs.

---

## C-12 Contract — Multiplier table administration (global and per asset)

**Labels:** `contract`

### Description

Admins tune pricing without redeploying. Expose `update_multiplier_table`, `admin_set_premium_multiplier`, `get_multiplier_table`, `admin_set_asset_premium_table` and `get_asset_premium_table`.

### Tasks

- Validate every table with `validate_table` before storing.
- Per-asset tables override the global table when present.
- Emit a `MultiplierTableUpdated` event with a table version counter.
- Tests: invalid table rejected, per-asset override applied, version increments.

### Additional Requirements

- Changes apply to **new** quotes only. Existing policies keep their bound premium.

### Acceptance Criteria

- Premium quotes reflect table changes immediately after update.
- Existing policies are unaffected (tested).

---

## C-13 Contract — `premium_calculator` standalone contract

**Labels:** `contract`

### Description

`contracts/premium_calculator` is a separately deployable pricing contract that lets pricing be upgraded independently of the core contract. It exposes `initialize(admin)`, `compute(CalcInput) -> CalcResult`, `get_version`, `abi_version`, `version`, `update_table` and `set_paused`.

### Tasks

- Rebuild `src/lib.rs`, `types.rs`, `storage.rs` and `errors.rs`.
- `compute` delegates to the shared pure premium engine (`premium_pure`).
- `abi_version()` returns a constant that is bumped only when `CalcInput`/`CalcResult` change shape.
- Tests: paused calculator rejects compute, table update validated, parity with in-contract engine on golden vectors.

### Additional Requirements

- Keep the ABI minimal. The core contract must be able to call it via `env.invoke_contract` without importing the crate.

### Acceptance Criteria

- Standalone WASM builds and passes tests.
- Golden-vector parity with the in-contract engine proven in tests.

---

## C-14 Contract — External calculator integration with ABI check and fallback

**Labels:** `contract`, `complex`

### Description

The core contract can route premium computation to an external calculator. If the calculator is unset, paused, or reports an unexpected ABI version, the contract must fall back to its in-contract engine (or fail closed, whichever is documented) rather than mis-price.

### Tasks

- Implement `set_calculator`, `set_calculator_with_version(addr, expected_version)`, `clear_calculator`, `get_calculator`, `get_expected_calc_version` and `get_last_calc_abi_version`.
- In `calculator.rs`, use `try_invoke_contract` so a failing calculator does not abort the whole transaction.
- Emit `CalculatorFallback` when falling back, so ops can alert on it.
- Tests with a mock calculator: happy path, wrong ABI, paused, panicking.

### Additional Requirements

- Document the fail-open vs. fail-closed decision and the reasoning.

### Acceptance Criteria

- All four calculator states are tested.
- The fallback event is emitted and asserted.

---

## C-15 Contract — Quote entrypoints: `generate_premium` and error explanations

**Labels:** `contract`

### Description

Users and the backend need a read-only quote. Implement `generate_premium(input, coverage)` and `generate_premium_for_asset(input, coverage, asset)`, plus `quote_error_message(code)`, which returns a stable human-readable reason for each quote failure.

### Tasks

- Validate coverage against `min_coverage_amount`, asset bounds and the policy type registry.
- Return a `QuoteResult { premium, coverage, asset, table_version, calc_source }`.
- Implement `quote_error_message` as a static lookup (no storage).
- Tests covering every quote error path.

### Additional Requirements

- Quotes must be simulate-only friendly. They must not write storage, so the backend can call them via RPC simulation for free.

### Acceptance Criteria

- `generate_premium` has no storage writes (asserted in a test via footprint or storage diff).
- Every failure maps to a documented message.

---

## C-16 Contract — `initiate_policy`: bind a policy and collect premium

**Labels:** `contract`, `complex`, `security`

### Description

This is the core purchase flow. `initiate_policy(holder, policy_type, risk_input, coverage, asset, duration_ledgers, options: InitiatePolicyOptions)` validates inputs, computes the premium, transfers it from the holder to the contract, stores the policy, registers the holder as a voter and emits `PolicyInitiated`.

### Tasks

- Enforce `holder.require_auth()`, bind-pause, asset allowlist, policy type active, region code (if given) valid, solvency ratio, whitelist (if enabled) and optional `expected_nonce` replay protection.
- Validate `metadata_uri` (non-empty, max length, allowed scheme) and `terms_hash` (non-zero).
- Validate deductible `0 <= d < coverage`.
- Transfer the premium and update ledger counters (reserve coverage).
- Increment the holder's policy counter and nonce. Add the holder to the voter registry.
- Tests for every validation branch, plus a full happy path asserting balances, storage and event.

### Additional Requirements

- The function must not exceed Soroban's parameter limit. Use the options struct.
- Document the duplicate-coverage rule (can a holder hold two active policies of the same type?).

### Acceptance Criteria

- Happy path and ≥10 negative tests pass.
- Premium moves exactly once and counters reconcile.

---

## C-17 Contract — Policy read APIs with bounded pagination

**Labels:** `contract`, `performance`

### Description

Frontends and indexers need efficient reads: `get_policy`, `get_policies_batch`, `list_policies(holder, start_after, limit)`, `get_policy_counter`, `has_policy`, `get_active_policy_count`, `holder_active_policy_count`, `get_inactive_policies` and `get_nonce`.

### Tasks

- Clamp `limit` to `PAGE_SIZE_MAX` silently, and document it.
- Batch reads return `Vec<Option<Policy>>` preserving input order.
- Tests measuring instruction budget at `PAGE_SIZE_MAX` to prove it fits within simulation limits.

### Additional Requirements

- Read entrypoints must not bump TTLs unless explicitly designed to. Document the decision.

### Acceptance Criteria

- Pagination is stable and has no gaps or duplicates across pages (tested).
- The budget test passes at max page size.

---

## C-18 Contract — Policy lifecycle: renewal, grace period, termination, expiry

**Labels:** `contract`, `complex`

### Description

Policies expire at `end_ledger`. Holders can renew within a grace period. Holders or admin can terminate with a `TerminationReason`. A keeper can sweep expired policies with `process_expired` to release reserved coverage.

### Tasks

- Implement `renew_policy`, `set_grace_period_ledgers`, `get_grace_period_ledgers`, `terminate_policy`, `admin_terminate_policy` and `process_expired(holder, policy_ids)`.
- Renewal recalculates the premium using the current table and collects payment.
- Termination releases reserved coverage, and optionally a pro-rata refund (document the product decision).
- Open claims block termination, or define the behaviour explicitly.
- Emit `PolicyRenewed`, `PolicyTerminated` and `PolicyExpired` events.

### Additional Requirements

- `process_expired` must be idempotent and bounded per call.

### Acceptance Criteria

- Tests for renewal inside and outside grace, termination with and without open claims, and idempotent expiry.

## C-19 Contract — Policy transfer and beneficiary management

**Labels:** `contract`, `security`

### Description

A holder may transfer a policy to another address (e.g. selling an insured asset) and may name a beneficiary who receives claim payouts. Both operations change who gets paid, so they are high-risk and need strict authorization and clear events.

### Tasks

- Implement `transfer_policy(holder, policy_id, new_holder)` requiring both `holder.require_auth()` and `new_holder.require_auth()`.
- Implement `set_beneficiary(holder, policy_id, beneficiary: Option<Address>)`.
- Implement `admin_update_policy_metadata_uri(holder, policy_id, uri)` with the same URI validation as policy binding.
- Block transfers while the policy has an open claim, and block transfers of inactive policies.
- Update per-holder indexes and voter registry membership on transfer.
- Emit `PolicyTransferred`, `BeneficiaryUpdated` and `PolicyMetadataUpdated` events.

### Additional Requirements

- A transfer must not reset `strike_count` or claim history. Document this in the function docs.

### Acceptance Criteria

- Tests: transfer with open claim rejected, missing new-holder auth rejected, indexes correct after transfer, beneficiary receives payout in an integration test.

---

## C-20 Contract — Solvency ratio, minimum coverage and protocol fee configuration

**Labels:** `contract`, `security`

### Description

The protocol must never sell more coverage than it can pay. A minimum solvency ratio (treasury / reserved coverage, in basis points) gates new policies. A protocol fee (bps) is taken from premiums and sent to a fee recipient.

### Tasks

- Implement `admin_set_min_solvency_ratio_bps`, `get_min_solvency_ratio_bps` and `check_solvency_ratio(new_coverage) -> bool`.
- Implement `admin_set_min_coverage_amount` / `get_min_coverage_amount`.
- Implement `admin_set_protocol_fee_bps` (capped, e.g. ≤ 2000 bps), `get_protocol_fee_bps`, `admin_set_fee_recipient` and `get_fee_recipient`.
- Provide an internal `split_premium(amount) -> (to_treasury, fee)` helper with rounding that never creates or loses stroops.
- Emit a `ConfigUpdated { key, old, new }` event for each setter.

### Additional Requirements

- Every bps setter validates `0..=10_000` and rejects out-of-range values with a typed error.

### Acceptance Criteria

- Property test: `to_treasury + fee == amount` for all inputs.
- The solvency check rejects coverage that would breach the ratio, and allows coverage that exactly meets it.

---

## C-21 Contract — Voter registry: eligibility, batch add, removal and caps

**Labels:** `contract`, `complex`

### Description

Claims are decided by a tokenless DAO of active policyholders. The registry tracks who may vote. It must stay bounded, support batch onboarding, and let admin remove bad actors, without letting a claimant vote on their own claim.

### Tasks

- Implement `get_voters`, `voter_registry_len`, `voter_registry_contains`, `add_voters_batch(addresses)`, `admin_remove_voter(voter)` and `admin_set_max_voters_per_claim` / `get_max_voters_per_claim`.
- Automatically add a holder when they get their first active policy, and remove them when they hold none.
- Store the registry in a paginated or bucketed layout so no single storage entry grows without limit.
- Emit `VoterAdded` and `VoterRemoved` events.

### Additional Requirements

- Document the Sybil-resistance assumption (one address per policy) and its known limits.

### Acceptance Criteria

- Tests: batch add dedupes, removal is idempotent, the registry size cap is enforced, and a holder with zero active policies is removed.

---

## C-22 Contract — `file_claim` with evidence, filing fee and anti-spam guards

**Labels:** `contract`, `complex`, `security`

### Description

`file_claim(claimant, policy_id, amount, details, evidence: Vec<ClaimEvidenceEntry>)` opens a claim against an active policy. Each evidence entry is an IPFS/HTTPS URL plus a SHA-256 content hash. Filing must be cheap for honest users and expensive for spammers.

### Tasks

- Validate: claimant is the policy holder (`require_auth`), the policy is active and in its coverage window, `0 < amount <= coverage`, amount within asset claim bounds, claims are not paused.
- Validate `details` length (`get_max_claim_description_bytes`) and evidence count within `admin_set_min_evidence_count` / `admin_set_max_evidence_count`.
- Validate each URL scheme and gateway host against `admin_set_gateway_allowlist` / `get_gateway_allowlist`, and reject all-zero hashes.
- Collect the filing fee (`admin_set_claim_filing_fee` / `get_claim_filing_fee`) if one is configured.
- Enforce one open claim per policy and a per-holder cooldown (`admin_set_cooldown_ledgers` / `get_cooldown_ledgers`).
- Snapshot the eligible voter set at filing time (excluding the claimant), and set `voting_deadline_ledger`.
- Emit a `ClaimFiled` event carrying the claim id, policy, amount, deductible and evidence hashes.

### Additional Requirements

- The voter snapshot must be bounded by the max-voters-per-claim cap. Document how voters are selected when the registry is larger than the cap (e.g. deterministic sampling seeded by the claim id).

### Acceptance Criteria

- The happy path plus at least 12 negative tests (one per validation rule) pass.
- The snapshot excludes the claimant and respects the cap.

---

## C-23 Contract — Rolling claim cap per policy

**Labels:** `contract`, `security`

### Description

Limit total approved claim value per policy within a rolling window of ledgers. This stops a single policy from draining the treasury through many small claims.

### Tasks

- Implement `rolling_claim_cap.rs` with a bucketed or sliding window keyed by `(holder, policy_id)`.
- Expose `get_rolling_claim_cap`, `get_rolling_claim_window_ledgers`, `get_rolling_claim_remaining(holder, policy_id)`, `get_rolling_claim_state`, `set_rolling_claim_cap` and `set_rolling_claim_window_ledgers`.
- Check the remaining cap at filing, and consume it at approval/payout. Document the choice.
- Tests at window boundaries (exact ledger where old usage expires).

### Additional Requirements

- Window state storage must be O(1) or O(buckets) per policy, not O(claims).

### Acceptance Criteria

- Boundary tests pass, and the cap is correctly restored after the window slides.

---

## C-24 Contract — Claim voting with quorum and deadline

**Labels:** `contract`, `complex`, `security`

### Description

Snapshotted voters call `vote_on_claim(voter, claim_id, VoteOption)` before `voting_deadline_ledger`. A claim is decided once quorum (bps of snapshot size) is reached and the deadline passes, or early if the outcome can no longer change.

### Tasks

- Only snapshotted voters may vote. Each votes once, with no vote changes (document this).
- Store votes per `(claim_id, voter)`, and keep running `approve_votes` / `reject_votes` counters.
- Implement `admin_set_quorum_bps`, `get_quorum_bps`, `get_claim_quorum_bps(claim_id)`, `admin_set_vote_duration_ledgers` and `get_vote_duration_ledgers`.
- Emit a `VoteCast` event.
- Tests: non-snapshot voter, double vote, vote after deadline, claimant self-vote, quorum boundary (exactly at quorum).

### Additional Requirements

- The quorum threshold is copied onto the claim at filing, so admin changes do not affect in-flight votes.

### Acceptance Criteria

- Every negative path has a typed error and a test.
- Tallies are always consistent with stored votes (invariant test).

---

## C-25 Contract — Claim finalization and keeper batch processing

**Labels:** `contract`, `complex`

### Description

After voting ends, anyone (typically a backend keeper) can finalize a claim. `finalize_claim(claim_id)` resolves one claim. `process_deadline` and `finalize_expired_batch(ids)` handle many, and `refresh_snapshot` repairs a snapshot whose voters have left the registry.

### Tasks

- Resolution rules: quorum met and approve > reject → `Approved`. Quorum met and reject ≥ approve → `Rejected`. No quorum at deadline → `Rejected`, with the reason recorded.
- On rejection, increment the policy's `strike_count`. At a threshold, deactivate the policy with `TerminationReason::ExcessiveRejections`.
- On approval, set `payout_deadline_ledger`.
- The batch entrypoint is bounded per call, skips non-finalizable ids without failing the batch, and returns per-id results.
- Implement `get_claim`, `get_claims_batch`, `get_claim_counter`, `list_claims(start_after, limit)` and `get_claim_history(holder)`.
- Emit a `ClaimFinalized` event.

### Additional Requirements

- Finalization must be idempotent. A second call on a finalized claim returns a typed error and changes nothing.

### Acceptance Criteria

- Tests for each resolution rule, the strike threshold, idempotency, and a mixed batch.

---

## C-26 Contract — Commit-reveal voting mode

**Labels:** `contract`, `complex`, `security`

### Description

Open voting lets later voters copy earlier ones. Commit-reveal hides votes until a reveal phase. Voters `commit_vote(voter, claim_id, hash)` where `hash = sha256(vote || salt || voter)`, then `reveal_vote(voter, claim_id, vote, salt)`.

### Tasks

- Implement `set_commit_reveal_phases(commit_ledgers, reveal_ledgers)`, `commit_vote` and `reveal_vote` in `commit_reveal.rs`.
- Only revealed votes count toward tallies. Unrevealed commits count toward participation only if the product spec says so (document the decision).
- Reject reveals that do not match the commitment, and reveals outside the reveal window.
- Emit `VoteCommitted` and `VoteRevealed` events. The commit event must not leak the vote.

### Additional Requirements

- Include `voter` in the hash preimage so commitments cannot be copied between voters.

### Acceptance Criteria

- Tests: mismatched reveal, late reveal, copied commitment, and correct tally after reveals.

---

## C-27 Contract — Vote delegation with expiry

**Labels:** `contract`

### Description

Voters who can't participate regularly may delegate their claim-voting power to another registered voter until an expiry ledger. Implement `delegate_vote(delegator, delegate, expiry_ledger)`, `revoke_vote_delegation(delegator)` and `get_vote_delegation(delegator)`.

### Tasks

- A delegate votes on behalf of delegators who are in the claim's voter snapshot. Each delegator's vote counts once.
- No delegation chains (A→B→C). Reject them explicitly.
- A delegator voting directly overrides the delegation for that claim.
- Emit `VoteDelegated` and `VoteDelegationRevoked` events.

### Additional Requirements

- Cap the number of delegators per delegate to bound voting cost.

### Acceptance Criteria

- Tests: expiry, chain rejection, direct-vote override, cap enforcement.

---

## C-28 Contract — Claim payout: deductible, fees, installments and payout timeout

**Labels:** `contract`, `complex`, `security`

### Description

`process_claim(claim_id)` pays an `Approved` or `AppealApproved` claim: `net = amount - deductible`, paid in the policy's asset (or the policy type's payout override asset) to the beneficiary or the holder. Large payouts may be split into installments via `disburse_installment`. If an approved claim isn't paid before `payout_deadline_ledger`, a keeper marks it `PayoutTimeout` with `process_payout_timeout`.

### Tasks

- Implement `process_claim`, `disburse_installment(claim_id)`, `process_payout_timeout(claim_id)`.
- `net <= 0` → typed `ClaimAmountZero` error and no transfer.
- Check the treasury has enough unreserved plus reserved balance for this claim, and release that claim's reservation.
- Set status `Paid` and emit `ClaimPaid { gross, deductible, net, recipient, asset }`.
- Implement `admin_register_policy_type`, `admin_deregister_policy_type`, `is_policy_type_active` and `get_policy_type_config`, including `payout_asset_override`.

### Additional Requirements

- Update state before the token transfer, and never pay twice (idempotency test).

### Acceptance Criteria

- Tests: deductible math, override asset, beneficiary recipient, double-pay rejected, installment totals equal net, timeout transition.

---

## C-29 Contract — Claim withdrawal and supplementary evidence

**Labels:** `contract`

### Description

Claimants may withdraw a claim before any vote is cast (`withdraw_claim`), and may add evidence while the claim is still `Processing` (`add_claim_evidence`).

### Tasks

- `withdraw_claim(claimant, claim_id)`: only the claimant, only with zero votes → `Withdrawn`. Refund the filing fee or not, per the documented product rule.
- `add_claim_evidence(claimant, claim_id, entries)`: same URL, hash and gateway validation as filing, total count ≤ max.
- Emit `ClaimWithdrawn` and `ClaimEvidenceAdded` events.

### Additional Requirements

- Withdrawal must stay available during a global pause, so users are never trapped.

### Acceptance Criteria

- Tests: withdraw after a vote rejected, evidence over cap rejected, evidence after voting closes rejected.

---

## C-30 Contract — Appeals: window, fresh voter round, elevated quorum

**Labels:** `contract`, `complex`

### Description

A claimant whose claim was `Rejected` may `open_appeal` within an appeal window. A new voter snapshot is taken, and appeal voters vote with `vote_on_appeal`. `finalize_appeal` resolves to `AppealApproved` (payable) or `AppealRejected` (final). Appeals use an elevated quorum.

### Tasks

- Implement `open_appeal`, `vote_on_appeal`, `finalize_appeal`, and `admin_set_elevated_quorum_bps`.
- Limit to one appeal per claim.
- The fresh snapshot excludes the claimant. Document whether original voters are excluded.
- Emit `AppealOpened`, `AppealVoteCast` and `AppealFinalized` events.

### Additional Requirements

- Appeals and admin disputes are mutually exclusive. Document and test the rule.

### Acceptance Criteria

- Property test of the appeal state machine: no sequence of calls reaches an invalid state.
- Tests: late appeal, second appeal, non-claimant appeal, elevated quorum boundary.

---

## C-31 Contract — Admin dispute, escalation and fraud scoring

**Labels:** `contract`, `security`

### Description

Admins need a safety valve. `admin_dispute_claim` freezes an approved claim (→ `Disputed`) pending review. `escalate_claim` bumps a claim to the elevated quorum. An off-chain fraud engine can write a score via `set_claim_fraud_score`. Scores above `admin_set_fraud_score_threshold` automatically require elevated quorum.

### Tasks

- Implement `admin_dispute_claim`, `escalate_claim`, `set_claim_fraud_score` (restricted to an oracle or admin role), `get_claim_fraud_score` and `admin_set_fraud_score_threshold`.
- Define the resolution path out of `Disputed` (release to `Approved` or reject), and document it.
- Emit `ClaimDisputed`, `ClaimEscalated` and `FraudScoreSet` events.

### Additional Requirements

- Document these as centralization risks in the module docs.

### Acceptance Criteria

- Tests: dispute freezes payout, score threshold triggers elevated quorum, only authorized callers can set scores.

---

## C-32 Contract — Scoped operator delegation for admin tasks

**Labels:** `contract`, `security`

### Description

The admin key should stay cold. Admin can grant an operator a limited set of scopes (e.g. `ProcessPayout`, `ManageVoters`, `SetFraudScore`) with an expiry. Implement `grant_delegation(operator, scopes, expiry_ledger)`, `revoke_delegation(operator)`, `get_delegation` and `list_active_delegated_scopes(operator)`.

### Tasks

- Add a `require_admin_or_scope(env, caller, Scope)` helper, and use it in every entrypoint that should support operators.
- Scopes are an enum. Unknown scopes are rejected.
- Emit `DelegationGranted` and `DelegationRevoked` events.

### Additional Requirements

- Operators can never grant scopes, rotate admin or unpause. List the admin-only operations in the docs.

### Acceptance Criteria

- Tests per scope: allowed with scope, denied without, denied after expiry, denied after revocation.

---

## C-33 Contract — Governance proposals with cooldown

**Labels:** `contract`

### Description

Voters can propose and vote on protocol parameter changes, e.g. quorum or fee changes. Implement `create_proposal(proposer, kind, payload)`, `vote_proposal(voter, proposal_id, support)`, `get_proposal`, `admin_set_gov_cooldown_ledgers` and `get_governance_cooldown_ledgers`.

### Tasks

- Enforce a per-proposer cooldown between proposals.
- Proposals have a voting window and quorum, and passed proposals are executed by admin or automatically (document which).
- Enforce a bounded set of proposal kinds with typed payloads.
- Emit `ProposalCreated`, `ProposalVoteCast` and `ProposalResolved` events.

### Additional Requirements

- Proposal payloads are validated with the same validators as the matching admin setters.

### Acceptance Criteria

- Tests: cooldown, double vote, execution of a passed proposal, rejection of an invalid payload.

---

## C-34 Contract — Versioned event schema for every state change

**Labels:** `contract`, `foundation`

### Description

The backend indexer reconstructs all state from events, so events are a public ABI just like errors. Define every event in `events.rs` using `#[contractevent]` with a consistent topic layout: `(namespace "niffyinsure", event_name, schema_version, primary_id)`.

### Tasks

- Define event structs for policies, claims, votes, appeals, treasury, admin and config changes.
- Document each event's topics and data fields in a table in `events.rs`, and in `docs/` for backend consumers.
- Add an `event_topic_layout` test asserting the exact topics of each event.
- Add a helper to bump `schema_version` for an event, and document the migration process for consumers.

### Additional Requirements

- Never remove fields from a released event version. Add a new version instead.

### Acceptance Criteria

- The topic layout test covers every event.
- An event reference doc exists and matches the code.

---

## C-35 Contract — Test suite triage, CI gates, gas baseline and deployment tooling

**Labels:** `contract`, `testing`, `devops`

### Description

`contracts/niffyinsure/tests/` still contains around 60 integration tests written against the deleted implementation, and `contracts/gas-baseline.json` and `contracts/deployment-registry.json` describe the old build. This issue makes the contract test and release pipeline trustworthy for the rebuild.

### Tasks

- Triage every file in `tests/`. For each one, keep it (it still describes required behaviour), rewrite it, or delete it. Record the decision in a table in the PR description.
- Gate tests that don't compile yet behind a `legacy-tests` feature so `cargo test` stays green.
- Add a CI job: `fmt --check`, `clippy -D warnings`, `test`, WASM build, and a WASM size check against a budget.
- Regenerate `gas-baseline.json` from a benchmark test, and fail CI when an entrypoint regresses more than an agreed percentage.
- Provide `scripts/deploy-contract.sh` (testnet) that builds, uploads, deploys, initializes, and writes the contract id, WASM hash and ledger to `deployment-registry.json`.
- Set up the `fuzz/` target for the pure premium engine and claim amount validation.

### Additional Requirements

- The deploy script must never contain secrets. It reads the deployer identity from the Stellar CLI keystore or an environment variable.

### Acceptance Criteria

- `cargo test` is green on a clean checkout.
- CI runs all gates on pull requests.
- A testnet deployment can be reproduced from the script alone.


---

# Backend (B-01 – B-45)

## B-01 Backend — Bootstrap the NestJS application (`main.ts`, `app.module.ts`)

**Labels:** `backend`, `foundation`

### Description

`backend/src` is empty. The service needs an entrypoint that starts a NestJS 11 app with production-safe defaults: security headers, CORS from config, global validation, versioned routes and graceful shutdown. Every module in the backend is registered here, so the bootstrap must be small, readable and fully tested.

### Tasks

- Create `src/main.ts`: `NestFactory.create`, `helmet()`, CORS from an env allowlist (no `*` in production), global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`, URI versioning (`/v1`), `enableShutdownHooks()`.
- Create `src/app.module.ts` that imports only what this issue needs: `ConfigModule` and a `/v1/ping` controller.
- Set a request body size limit, and trust proxy settings from env.
- Add `test/app.e2e-spec.ts` coverage: the app boots, `/v1/ping` returns 200, unknown fields are rejected by validation, CORS blocks unknown origins.

### Additional Requirements

- Do not import feature modules that don't exist. The bootstrap must compile on its own.
- Remove `typeorm` from `package.json` if nothing uses it. The project standard ORM is Prisma.

### Acceptance Criteria

- `npm run build` and `npm run start` work. `npm run lint` and `npm run typecheck` pass.
- E2E tests above pass in CI.

---

## B-02 Backend — Typed, validated environment configuration

**Labels:** `backend`, `foundation`, `security`

### Description

The service reads dozens of env vars (database, Redis, Soroban RPC, Horizon, contract ids, JWT secrets, IPFS keys, SMTP). A missing or malformed variable must stop the app at boot with a clear message, not fail at runtime hours later.

### Tasks

- Create `src/config/env.schema.ts` with a zod schema for every variable, with defaults only where safe.
- Create `src/config/network.config.ts` mapping `STELLAR_NETWORK` (`testnet`, `mainnet`, `futurenet`, `local`) to a network passphrase, RPC URL and Horizon URL.
- Expose a typed `AppConfigService` so no code calls `process.env` directly. Add an ESLint `no-restricted-properties` rule to enforce this.
- Keep `backend/.env.example` in sync. Fix `backend/scripts/check-env-parity.ts` to compare the schema with `.env.example`, and run it in CI.

### Additional Requirements

- Secrets never appear in logs, including in validation error messages (log the key name only).
- Mainnet mode requires every contract id and secret to be explicitly set, with no defaults.

### Acceptance Criteria

- Boot fails with a readable list of missing or invalid keys.
- The parity script fails CI when `.env.example` and the schema diverge.
- Unit tests cover each network profile.

---

## B-03 Backend — Error catalog and unified error response envelope

**Labels:** `backend`, `foundation`

### Description

Clients need stable, machine-readable errors. Define an error catalog where each entry has a code, HTTP status and message, including the numeric contract error codes, and a global filter that renders every error in one envelope: `{ error: { code, message, details?, requestId } }`.

### Tasks

- Create `src/common/errors/error-catalog.json` and a typed loader.
- Add an `AppException(code, details?)` class.
- Add a global `HttpExceptionFilter` that maps `AppException`, Nest `HttpException`, validation errors, Prisma known errors and unknown errors to the envelope.
- Map Soroban contract error discriminants (read from simulation results) to catalog codes.
- Add a `GET /v1/errors` endpoint that serves the catalog, so the frontend can render messages.

### Additional Requirements

- Unknown errors return a generic 500 message. Stack traces are never sent to clients.
- A test fails if two catalog entries share a code.

### Acceptance Criteria

- Every error path returns the envelope (tested per error type).
- The catalog endpoint is public and cached.

---

## B-04 Backend — Structured logging, request IDs and OpenTelemetry tracing

**Labels:** `backend`, `devops`

### Description

Debugging production requires correlated logs and traces. Use winston JSON logs with a per-request ID, and OpenTelemetry auto-instrumentation exporting OTLP traces when configured.

### Tasks

- Create `src/logging/`: a winston logger as the Nest logger, a middleware that sets and propagates `x-request-id`, and an `AsyncLocalStorage` context for the request id and wallet address.
- Create `src/tracing.ts`, loaded before Nest boots, that starts the OTel NodeSDK only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
- Redact sensitive fields (authorization headers, JWTs, signatures, emails) in logs.
- Include the request id in error envelopes.

### Additional Requirements

- Tracing must add no measurable overhead when disabled.

### Acceptance Criteria

- Log lines are valid JSON with `requestId`.
- A redaction unit test proves sensitive fields are masked.
- Traces appear in a local collector when enabled (document how to check).

---

## B-05 Backend — Prisma module with read replica and migration baseline

**Labels:** `backend`, `foundation`, `complex`

### Description

`backend/prisma/schema.prisma` and about 18 migrations remain from the old build. The rebuild needs a `PrismaModule` with a primary client and an optional read-replica client, and a clean decision on whether to keep or squash the migration history.

### Tasks

- Create `src/prisma/prisma.service.ts` (primary) and `prisma-replica.service.ts` (falls back to primary when no replica URL is configured). Connect on module init and disconnect on shutdown.
- Review every model in the schema. Remove models with no planned use, and document each model's owner in a schema comment.
- Decide between keeping the migration history and squashing to a single baseline. If squashing, provide a documented procedure for existing databases (`prisma migrate resolve`). Note: `011_add_reindex_progress.sql` is outside Prisma's naming scheme and must be handled.
- Add `npm run db:migrate`, `db:seed` and `db:reset` scripts. The seed script creates deterministic dev data.

### Additional Requirements

- Soft-delete (`deletedAt`) behaviour must be applied consistently, with a Prisma extension or explicit filters, and documented.

### Acceptance Criteria

- `prisma migrate deploy` works on an empty Postgres database.
- The replica fallback is unit tested.
- The migration decision is recorded in `backend/prisma/README.md`.

---

## B-06 Backend — Redis module, cache helpers and cache metrics

**Labels:** `backend`, `foundation`, `performance`

### Description

Redis backs caching, rate limiting, BullMQ queues and pub/sub. Provide one Redis module with named connections and a small typed cache helper with TTLs and stampede protection.

### Tasks

- Create `src/redis/`: an ioredis client factory (a separate connection for BullMQ with `maxRetriesPerRequest: null`), health ping, and graceful quit.
- Add a `CacheService` with `get<T>`, `set<T>(ttl)`, `wrap(key, ttl, fn)` (single-flight lock to prevent stampedes) and `delByPrefix`.
- Namespace keys by environment and tenant: `niffy:{env}:{tenant}:...`.
- Add Prometheus counters for cache hit, miss and error.

### Additional Requirements

- Cache failures degrade to a direct call. Redis being down must never fail a read request that could be served without cache.

### Acceptance Criteria

- Unit tests use a Redis mock. An integration test runs against a real Redis in CI.
- The fallback when Redis is down is tested.

---

## B-07 Backend — Health, liveness and readiness probes

**Labels:** `backend`, `devops`

### Description

Kubernetes/Docker needs `/health/live` (process is up) and `/health/ready` (dependencies are reachable). Readiness checks Postgres, Redis, Soroban RPC, Horizon and indexer lag, using `@nestjs/terminus`.

### Tasks

- Create `src/health/` with indicators for Prisma, Redis, Soroban RPC (`getHealth`), Horizon (root endpoint) and indexer lag (latest ledger minus cursor, compared with a threshold).
- Give each indicator a short timeout, so readiness never hangs.
- Make critical and non-critical dependencies configurable. For example, Horizon being down marks the service degraded, not unready.

### Additional Requirements

- Health endpoints are excluded from rate limiting and auth, and do not leak internal hostnames.

### Acceptance Criteria

- Tests simulate each dependency failing and assert the probe result.

---

## B-08 Backend — Prometheus metrics endpoint with label cardinality guard

**Labels:** `backend`, `devops`, `security`

### Description

Expose `/metrics` for Prometheus with HTTP latency histograms, queue depths and business counters (policies bound, claims filed, payouts). Protect the endpoint and guard against label explosion (e.g. wallet addresses used as labels).

### Tasks

- Create `src/metrics/` using `@willsoto/nestjs-prometheus`, with default Node metrics plus an HTTP histogram labelled by route template (not raw URL), method and status.
- Add a `MetricsAuthMiddleware` (bearer token or IP allowlist from config).
- Add a `CardinalityGuard` that caps distinct values per label and drops excess values into `__other__`.

### Additional Requirements

- Never use user-supplied values (addresses, ids) as labels.

### Acceptance Criteria

- `/metrics` requires auth.
- A cardinality test shows the cap in effect.

---

## B-09 Backend — Rate limiting with Redis storage and per-route policies

**Labels:** `backend`, `security`

### Description

Public endpoints need abuse protection that works across multiple instances. Use `@nestjs/throttler` with Redis storage, a default global limit, and stricter per-route limits for expensive operations such as claim filing, uploads, appeals and auth challenges.

### Tasks

- Create `src/rate-limit/`: Redis throttler storage, a `@RateLimit(policyName)` decorator, and named policies in config.
- Key limits by wallet address when authenticated, and by IP otherwise (respecting trusted proxy settings).
- Return `429` in the standard error envelope with a `Retry-After` header.

### Additional Requirements

- Health and metrics routes are exempt.

### Acceptance Criteria

- Tests hit a route past its limit and assert 429 with `Retry-After`.
- Limits are shared across two app instances in an integration test.

---

## B-10 Backend — Wallet authentication: challenge, signature verification and JWT

**Labels:** `backend`, `security`, `complex`

### Description

Users log in by signing a server-issued challenge with their Stellar wallet (SEP-10 style). The backend verifies the signature against the G-address and issues a short-lived JWT access token plus a refresh mechanism.

### Tasks

- `POST /v1/auth/challenge { address }` returns a nonce-bearing challenge (a SEP-10 challenge transaction, or a signed message with domain, nonce and expiry). The nonce is stored in Redis with a TTL.
- `POST /v1/auth/verify { address, signedChallenge }` verifies the signature with `@stellar/stellar-sdk`, consumes the nonce once, and returns `{ accessToken, expiresIn }`, with an httpOnly refresh cookie.
- `POST /v1/auth/refresh` and `POST /v1/auth/logout` (revoke the refresh token).
- Normalize and validate addresses (StrKey checks, uppercase G-address).

### Additional Requirements

- Nonces are single-use and expire in 5 minutes or less. Replaying a nonce must fail.
- JWT secrets rotate using a `kid` header, with an old and a new secret accepted during rotation.

### Acceptance Criteria

- Tests: valid login, wrong signer, expired nonce, replayed nonce, malformed address, refresh and logout.

---

## B-11 Backend — Auth guards, roles and request decorators

**Labels:** `backend`, `security`

### Description

Controllers need declarative auth: `JwtAuthGuard` (required), `OptionalJwtGuard`, a `RolesGuard` with `@Roles('admin' | 'operator' | 'support')`, and a `@WalletAddress()` parameter decorator.

### Tasks

- Implement the guards with `@nestjs/passport` and `passport-jwt`.
- Resolve roles from an admin address allowlist in config, or from a `Role` table. Document the choice.
- Add a `@Public()` decorator for routes that skip the global guard.

### Additional Requirements

- The default is deny: the guard is registered globally, and routes opt out with `@Public()`.

### Acceptance Criteria

- Tests: no token → 401, wrong role → 403, `@Public()` accessible, the decorator returns the normalized address.

---

## B-12 Backend — Soroban RPC client with simulation, submission and circuit breaker

**Labels:** `backend`, `foundation`, `complex`

### Description

All contract interaction goes through one service: read-only calls via simulation, building unsigned transactions for users to sign, and submitting signed XDR then polling for the result. RPC outages must not cascade, so wrap calls in an `opossum` circuit breaker with retries.

### Tasks

- Create `src/soroban/soroban.service.ts` with `simulate(method, args)`, `buildInvokeTx(source, method, args)` (simulate, then `prepareTransaction`, returning XDR), `submit(signedXdr)` and `waitForResult(hash, timeout)`.
- Add typed argument encoders and result decoders (`nativeToScVal` / `scValToNative`) for the contract's core types.
- Add a circuit breaker with exponential-backoff retries on transient errors only (never retry a submission that may have landed without first checking its hash).
- Map contract errors (from simulation diagnostics) to typed errors.

### Additional Requirements

- The service is network-agnostic. It takes its configuration from the typed config (network passphrase, RPC URL, contract id).

### Acceptance Criteria

- Unit tests with a mocked RPC cover success, contract error, timeout and breaker open.
- An optional integration test runs against testnet or a local quickstart container, behind an env flag.

---

## B-13 Backend — Horizon service for account and transaction history

**Labels:** `backend`

### Description

The UI shows a user's transaction history and balances. Proxy Horizon with filtering, pagination and rate-limit awareness, so the frontend doesn't hit Horizon directly and we can cache results.

### Tasks

- Create `src/horizon/`: `GET /v1/accounts/:address/transactions` (cursor pagination, filtered to the insurance contract's operations when requested) and `GET /v1/accounts/:address/balances`.
- Add a field filter that returns only the fields the UI needs.
- Respect Horizon rate-limit headers with a backoff, and cache responses briefly.

### Additional Requirements

- Validate `:address` as a StrKey before calling Horizon.

### Acceptance Criteria

- Tests with mocked Horizon cover pagination, filtering, 429 handling and invalid addresses.

---

## B-14 Backend — Premium engine golden-vector parity tests

**Labels:** `backend`, `testing`

### Description

The backend displays estimated premiums and must agree exactly with the on-chain engine. Implement the premium formula in TypeScript (integer and BigInt math only) and verify it against a golden-vector JSON file produced by the contract's test suite.

### Tasks

- Create `src/premium/premium.engine.ts`: a pure function from `(riskInput, table, coverage)` to a premium, as a `bigint`.
- Create `src/premium/golden-vectors.json` (copied or generated from the contract output) and a test that runs every vector.
- Add a CI step that fails if the contract's golden vectors file changes without the backend copy being updated.

### Additional Requirements

- No floating point anywhere in the premium path.

### Acceptance Criteria

- 100% of golden vectors match.
- A lint rule or test prevents `Number` arithmetic in the engine.

---

## B-15 Backend — Quote API with simulation and short-lived caching

**Labels:** `backend`, `performance`

### Description

`POST /v1/quotes` returns a premium quote for a risk profile. It simulates `generate_premium` on the contract (the source of truth) and caches identical requests for a short time to protect RPC.

### Tasks

- Add a DTO with class-validator rules for policy type, region, age band, coverage tier, safety score, coverage amount and asset.
- Build a cache key from a canonical serialization of the DTO plus the multiplier table version.
- Return `{ premium, coverage, asset, decimals, tableVersion, expiresAt }`.
- Map contract quote errors to catalog codes with human messages.

### Additional Requirements

- Invalidate the cache when a multiplier-table-updated event is observed, or keep the TTL at 60 seconds or less.

### Acceptance Criteria

- Tests: validation errors, cache hit and miss, contract error mapping.
- The cache key utility is unit tested for canonical ordering.

---

## B-16 Backend — Build unsigned policy purchase transactions

**Labels:** `backend`

### Description

The frontend should not assemble Soroban transactions by hand. `POST /v1/policies/build` returns an unsigned, prepared XDR for `initiate_policy` that the user signs in their wallet.

### Tasks

- Validate the request (holder address, risk input, coverage, asset, duration, beneficiary, deductible, metadata URI, terms hash).
- Pre-check the holder's balance and trustline for the asset, and return a clear error before building.
- Return `{ xdr, networkPassphrase, estimatedFee, simulatedPremium, expiresAtLedger }`.

### Additional Requirements

- Never sign on behalf of the user. The server holds no user keys.

### Acceptance Criteria

- Tests: successful build, insufficient balance, missing trustline, invalid input.

---

## B-17 Backend — Transaction submission queue with idempotency and backpressure

**Labels:** `backend`, `complex`

### Description

`POST /v1/tx/submit { signedXdr }` enqueues a signed transaction to BullMQ, and a worker submits it to RPC and tracks its status. Clients poll `GET /v1/tx/:hash` or receive updates over SSE.

### Tasks

- Add an `Idempotency-Key` header. The same key returns the same job and hash.
- The worker submits, polls to completion, persists the result (`TxSubmission` table), and retries safely only when the hash is not found on chain.
- Add backpressure: when the queue depth passes a threshold, return 503 with `Retry-After`.
- Add a Bull Board UI at `/admin/queues`, admin only.

### Additional Requirements

- Verify that the XDR's network passphrase and contract id match config before enqueuing. Reject anything else.

### Acceptance Criteria

- Tests: duplicate idempotency key, backpressure 503, foreign-network XDR rejected, worker success and failure paths.

---

## B-18 Backend — Contract event indexer with durable ledger cursor

**Labels:** `backend`, `complex`

### Description

The backend's database is a projection of on-chain state. The indexer polls Soroban RPC `getEvents` for the contract, stores raw events, and advances a persisted ledger cursor exactly once per processed batch.

### Tasks

- Create `src/indexer/indexer.worker.ts`: a poll loop with a configurable interval, fetching pages from the cursor.
- Store each event in `RawEvent`, unique on `(txHash, eventIndex)`, and advance `LedgerCursor` in the same DB transaction.
- Detect gaps (RPC retention window exceeded) and raise an alert (`LedgerGapAlertDedup`).
- Run a single active indexer using a Redis leader lock.

### Additional Requirements

- Processing is idempotent. Re-running a range must not create duplicates.

### Acceptance Criteria

- Tests: resume from cursor after restart, duplicate event ignored, gap detection, two instances with only one leader.

---

## B-19 Backend — Event parser registry and domain projections

**Labels:** `backend`, `complex`

### Description

Raw events must be decoded into domain rows (`Policy`, `Claim`, `Vote`, `PolicyRenewal`, `RegisteredVoter`, etc.). A parser registry maps `(eventName, schemaVersion)` to a parser, so new event versions can be added without touching existing ones.

### Tasks

- Create `src/indexer/parsers/`: a registry, one parser per event type and version, and zod validation of the decoded payload.
- Add projection handlers that upsert domain tables inside a transaction.
- Store unknown event types or versions with status `unparsed`, and alert. Never crash the indexer.

### Additional Requirements

- Projections must be replayable from `RawEvent` alone (see the reindex worker).

### Acceptance Criteria

- Each parser has a test using a real XDR fixture.
- The unknown-event path is tested.

---

## B-20 Backend — Backfill, reindex and on-chain reconciliation workers

**Labels:** `backend`, `complex`, `devops`

### Description

Operators need to rebuild projections (after a parser fix) and verify them against chain state. Add a reindex worker that replays `RawEvent`, a backfill worker for historical ledgers, and a reconciliation job that samples policies and claims and compares them with contract reads.

### Tasks

- Reindex: truncate the target projections, replay in ledger order, and persist progress so it can resume.
- Backfill: fetch a ledger range from RPC into `RawEvent`, within retention limits.
- Reconciliation: a nightly BullMQ job compares N random entities with `get_policy` / `get_claim`, and records and alerts on drift.
- Add admin-only endpoints to trigger each job and view progress.

### Additional Requirements

- Reindexing must not block the live indexer. Use a shadow table swap, or document the pause.

### Acceptance Criteria

- Tests: reindex produces identical projections, a resume after a crash, and drift detection.

---

## B-21 Backend — Policy read API: list, search and detail

**Labels:** `backend`

### Description

The frontend needs `GET /v1/policies` (the current holder's policies, with filters by status, type and asset), `GET /v1/policies/:holder/:policyId`, and an admin search endpoint. Data comes from the indexed projection.

### Tasks

- Add cursor-based pagination via a shared helper: opaque base64 cursor, `limit` capped at 100.
- Filter and sort by status, type, `endLedger`, and created date.
- Add a response DTO with derived fields: `daysRemaining`, `isInGracePeriod` and `openClaimId`.
- Holders only see their own policies. Admins see all of them.

### Additional Requirements

- Add DB indexes for every filter and sort combination, with the migration included.

### Acceptance Criteria

- Tests: pagination stability, authorization, filter combinations.

---

## B-22 Backend — Policy renewal API and expiry reminders

**Labels:** `backend`

### Description

Holders renew policies before expiry. Provide `POST /v1/policies/:id/renew/build` (returns unsigned XDR for `renew_policy` with a fresh quote) and a scheduled job that sends expiry reminders at 30, 7 and 1 day(s) before expiry.

### Tasks

- Check renewal eligibility: active, or within grace, and no blocking open claim.
- The reminder job queries upcoming expiries, dedupes sends per policy and threshold, and dispatches through the notification system.
- Record renewals in `PolicyRenewal` from indexed events.

### Additional Requirements

- Reminders respect the user's notification preferences and quiet hours.

### Acceptance Criteria

- Tests: eligibility rules, reminder dedupe, preference opt-out respected.

---

## B-23 Backend — Claims read API: list, search and detail

**Labels:** `backend`

### Description

Provide `GET /v1/claims` (filter by status, policy, claimant, date, severity; full-text search on details), `GET /v1/claims/:id` (with evidence, vote tallies, timeline and appeal info), and a claim-view mapper that hides fields depending on the viewer.

### Tasks

- Add Postgres full-text search on the claim description, with a migration for the search index.
- Build the timeline from indexed events: filed, votes, finalized, appealed, paid.
- The claim-view mapper shows voter identities only to admins, and aggregate tallies to everyone.

### Additional Requirements

- Claims are public for transparency, except personal details, which only the claimant and admins may see. Document exactly which fields are redacted.

### Acceptance Criteria

- Tests: redaction per role, search relevance, pagination.

## B-24 Backend — Build unsigned claim filing transactions

**Labels:** `backend`, `security`

### Description

`POST /v1/claims/build` returns unsigned XDR for `file_claim` from the claimant's inputs and previously uploaded evidence (URLs plus SHA-256 hashes). The server pre-validates everything the contract will check, so users get fast, friendly errors instead of failed transactions.

### Tasks

- Pre-validate: the policy belongs to the caller and is active, the amount is within coverage and asset bounds, the description length is within limits, the evidence count is within min/max, evidence URLs are on the gateway allowlist, and there is no open claim for the policy.
- Evidence must reference uploads that belong to this caller, and hashes must match the stored metadata.
- Return the XDR and the filing fee (if any) that will be charged.

### Additional Requirements

- Apply a strict rate limit: claim building is expensive and a spam vector.

### Acceptance Criteria

- One test per pre-validation rule.
- Using another user's evidence is rejected.

---

## B-25 Backend — Evidence upload to IPFS with validation and content hashing

**Labels:** `backend`, `security`, `complex`

### Description

Claimants upload photos and PDFs as evidence. `POST /v1/evidence` validates the file, strips metadata, computes SHA-256, pins it to IPFS via a pluggable provider (Pinata, web3.storage, or a mock for dev and tests), and stores `EvidenceMetadata`.

### Tasks

- Add an `IpfsProvider` interface with `pin(buffer, name)`, `unpin(cid)` and `status(cid)`, three implementations, and selection from config.
- Validate the file with a magic-byte MIME check (not just the extension), an allowlist (jpeg, png, webp, pdf), size and pixel limits.
- Re-encode images with `sharp` to strip EXIF and GPS data. Compute the hash after sanitizing.
- Support an `Idempotency-Key`: re-uploading the same file returns the existing record.
- Return `{ cid, url, sha256, size, mimeType }`.

### Additional Requirements

- Never trust client-provided hashes or MIME types.
- PDFs with JavaScript or embedded files are rejected, or sanitized (document which).

### Acceptance Criteria

- Tests: disguised file type rejected, EXIF removed, idempotent re-upload, provider failure surfaced cleanly.

---

## B-26 Backend — Voting API: eligibility, tallies and vote transaction building

**Labels:** `backend`

### Description

Voters need to know which claims they can vote on, and to cast votes. Provide `GET /v1/votes/pending` (claims where the caller is in the voter snapshot and hasn't voted), `GET /v1/claims/:id/votes` (tallies, quorum progress, deadline) and `POST /v1/claims/:id/votes/build` (unsigned XDR for `vote_on_claim`, or commit/reveal when that mode is active).

### Tasks

- Compute eligibility from the indexed voter snapshot.
- Calculate quorum progress and ledger-to-time estimates from the average ledger close time.
- For commit-reveal, generate the salt on the client. The server never sees the salt before reveal. Document the client flow in the endpoint docs.

### Additional Requirements

- Self-votes on one's own claim are rejected before building.

### Acceptance Criteria

- Tests: eligibility, already voted, deadline passed, quorum calculation.

---

## B-27 Backend — Claim deadline and payout keeper jobs

**Labels:** `backend`, `complex`

### Description

Claims don't finalize themselves. A keeper finds claims past their voting deadline and calls `finalize_expired_batch`. It also finds approved claims past the payout deadline and calls `process_payout_timeout`, and resolves appeals past their deadline. The keeper signs with a dedicated low-privilege keeper key.

### Tasks

- Add a scheduled BullMQ repeatable job that queries candidates from projections, batches them within contract limits, and submits.
- Load the keeper key from a secret (env or KMS). Alert on low balance.
- Record per-claim results. Retry failures with backoff, and send to a dead-letter queue after N attempts.
- Add a metric: time from deadline to finalization.

### Additional Requirements

- Only one keeper instance acts at a time (Redis lock).
- Use a dry-run simulation before submitting, and skip claims already finalized on chain.

### Acceptance Criteria

- Tests: batch composition, already-finalized skip, lock contention, dead-letter path.

---

## B-28 Backend — Appeals API and appeal-window reminders

**Labels:** `backend`

### Description

Rejected claimants may appeal within a window. Provide `POST /v1/claims/:id/appeal/build` (unsigned XDR for `open_appeal`), appeal state in claim detail, and reminders sent when the window opens and 24 hours before it closes.

### Tasks

- Check eligibility: the caller is the claimant, the status is `Rejected`, the window is open, and no previous appeal exists.
- Build appeal vote transactions for appeal voters.
- Add an SLA monitor that alerts when appeals sit unresolved past their deadline.

### Additional Requirements

- Apply stricter rate limits than normal claim routes.

### Acceptance Criteria

- Tests: each eligibility rule, reminder timing, SLA alert.

---

## B-29 Backend — Server-Sent Events stream for live claim and transaction updates

**Labels:** `backend`, `performance`

### Description

The UI should update live when votes land or transactions confirm. `GET /v1/events/stream` is an SSE endpoint that pushes events filtered to what the caller subscribed to (claim ids, own address).

### Tasks

- Fan out across instances with Redis pub/sub.
- Add a connection registry with a per-user connection cap, heartbeats every 15 seconds, and cleanup on disconnect.
- Support `Last-Event-ID` resume from a short Redis stream buffer.
- Define an event payload schema (typed, versioned) and document it.

### Additional Requirements

- Authentication uses the JWT, since `EventSource` can't set headers. Use a short-lived stream token issued by a normal authenticated endpoint.

### Acceptance Criteria

- Tests: an event published on one instance reaches a client on another, the cap is enforced, and resume works.

---

## B-30 Backend — GraphQL API with depth, complexity and auth limits

**Labels:** `backend`, `security`

### Description

Some clients (dashboards, partners) prefer GraphQL. Expose read-only `Policy`, `Claim`, `Vote` and `Holder` types via Apollo, with DataLoader batching and strict query limits.

### Tasks

- Add a code-first schema with resolvers backed by the same services as REST.
- Add a DataLoader per request for N+1-prone relations.
- Set a depth limit, a query complexity limit and a per-operation rate limit. Disable introspection in production.
- Reuse the REST auth guards: wallet auth for own data, and admin for admin fields.

### Additional Requirements

- No mutations in this issue. Document why writes stay on REST.

### Acceptance Criteria

- Tests: depth and complexity rejection, the DataLoader prevents N+1 (assert the query count), auth on protected fields.

---

## B-31 Backend — Notifications: preferences, dispatcher, email and in-app

**Labels:** `backend`

### Description

Users receive notifications for claim updates, votes needed, renewals and appeals. Build a dispatcher that routes a domain event to channels (email via nodemailer, in-app `Notification` rows) according to `NotificationPreference`.

### Tasks

- Add `GET` and `PUT /v1/notifications/preferences` (per event type × channel, quiet hours, digest mode).
- Add `GET /v1/notifications` (in-app list, cursor pagination) and `POST /v1/notifications/:id/read`.
- Add a BullMQ worker for sending, with templates per event type, and batch claim updates into digests.
- Add email verification before enabling the email channel.

### Additional Requirements

- Unsubscribe links are signed and one-click (RFC 8058 headers).
- No personal data in queue payloads beyond ids. Load the details in the worker.

### Acceptance Criteria

- Tests: preference routing, quiet hours deferral, digest batching, unsubscribe.

---

## B-32 Backend — Outbound webhooks with HMAC signing and retries

**Labels:** `backend`, `security`

### Description

Partners (tenants, integrators) subscribe to events such as `policy.created`, `claim.finalized` and `claim.paid`. Deliver signed webhook POSTs with retries and an idempotency key.

### Tasks

- Add CRUD for webhook subscriptions (admin or tenant scoped): URL, events and secret.
- Sign payloads with `X-Niffy-Signature: t=<ts>,v1=<hmac-sha256>`. Document verification.
- Add a delivery queue with exponential backoff, a max-attempts limit, and a delivery log with the response code.
- Validate URLs against SSRF: https only, and block private, loopback and link-local IPs, including after DNS resolution.

### Additional Requirements

- Include a replay-protection timestamp. Recommend a 5-minute tolerance in the docs.

### Acceptance Criteria

- Tests: signature verification example, retry schedule, SSRF blocks, delivery log.

---

## B-33 Backend — Holder profile API with audit log

**Labels:** `backend`

### Description

Holders can set an optional display name, email (for notifications), locale and avatar. Every change is audit logged. `lastSeenAt` is updated on authenticated activity, with throttling.

### Tasks

- Add `GET` and `PATCH /v1/profile`, with a DTO and validation (display name length and charset, email format, locale in the supported list).
- Write a `ProfileAuditLog` row with old and new values for each change. Emails are masked in the log.
- Update `lastSeenAt` at most once per 5 minutes per user.

### Additional Requirements

- The profile is optional. Every feature works without one.

### Acceptance Criteria

- Tests: validation, audit rows written, `lastSeenAt` throttling.

---

## B-34 Backend — Admin API: stats, analytics, audit log and exports

**Labels:** `backend`

### Description

Operators need a dashboard: totals (policies, active coverage, premiums, claims by status, payouts), time series, a solvency ratio, and CSV exports of claims and policies. Every admin action is written to `AdminAuditLog`.

### Tasks

- Add `GET /v1/admin/stats`, `GET /v1/admin/analytics?range=`, `GET /v1/admin/claims/export.csv` (streamed, not buffered) and `GET /v1/admin/audit-log`.
- Add an `@Audited(action)` interceptor that records the actor, action, target, request id and outcome.
- Cache heavy aggregates for a short time.

### Additional Requirements

- CSV output is protected against formula injection (prefix `=`, `+`, `-`, `@` cells).

### Acceptance Criteria

- Tests: role enforcement, CSV injection escaping, audit rows for each admin route.

---

## B-35 Backend — Feature flags and allowed-asset configuration

**Labels:** `backend`

### Description

Product features are rolled out gradually with flags, and the list of allowed assets (code, issuer, contract id, decimals, display info) is managed by admins and cached for the frontend.

### Tasks

- Add a `FeatureFlagService` backed by the `FeatureFlag` table with a Redis cache. Support boolean, percentage and allowlist flags.
- Add a `@Feature('flag')` guard for routes, and `GET /v1/flags` returning flags evaluated for the caller.
- Add admin CRUD for flags and assets. Add `GET /v1/assets` (public, cached).
- Seed default flags at boot when they are missing.

### Additional Requirements

- Asset config must be cross-checked with the contract allowlist. Flag mismatches in the admin UI response.

### Acceptance Criteria

- Tests: percentage rollout is deterministic per address, cache invalidation on update, mismatch detection.

---

## B-36 Backend — Multi-tenancy: tenant resolution, isolation and onboarding

**Labels:** `backend`, `security`, `complex`

### Description

The platform can serve several white-label tenants. Each request resolves a tenant (from the host or `X-Tenant-Id`), and all data access is scoped to that tenant.

### Tasks

- Add tenant middleware and an `AsyncLocalStorage` tenant context.
- Add a Prisma extension or helper that injects `tenantId` filters into every query on tenant-scoped models.
- Add tenant onboarding (admin): create a tenant, its config (branding, allowed assets, feature flags), and a `TenantConfigAuditLog`.
- Add `GET /v1/tenant/config` (public branding info).

### Additional Requirements

- Add a cross-tenant isolation test suite that attempts reads and writes across tenants on every scoped model.

### Acceptance Criteria

- The isolation suite passes.
- A request without a tenant uses the default tenant explicitly, never "all tenants".

---

## B-37 Backend — Support center: tickets, replies, captcha and FAQ

**Labels:** `backend`

### Description

Users can open support tickets (optionally linked to a claim or policy), get staff replies, and browse an FAQ. Anonymous ticket creation is protected by captcha.

### Tasks

- Add `POST /v1/support/tickets` (captcha verified when anonymous), `GET /v1/support/tickets/:id` (owner or support role), replies, and status transitions (`open` → `pending` → `resolved` → `closed`).
- Track `firstRespondedAt` for SLA metrics.
- Add FAQ CRUD for admins, a public list with search, and helpful/not-helpful counters in `FaqStat`.

### Additional Requirements

- Ticket bodies are stored as plain text and escaped on output. No HTML.

### Acceptance Criteria

- Tests: captcha failure, access control, status transition rules, FAQ search.

---

## B-38 Backend — Posts/announcements with sanitization, scheduling and feeds

**Labels:** `backend`, `security`

### Description

The team publishes announcements (protocol updates, incident notices). Posts have draft, scheduled and published states, sanitized Markdown/HTML bodies, and RSS/Atom feeds.

### Tasks

- Add admin CRUD for posts, and public `GET /v1/posts` (published only, paginated) and `GET /v1/posts/:slug`.
- Sanitize bodies with DOMPurify on jsdom, using a strict allowlist of tags and attributes.
- Add a scheduler job that publishes posts when `publishAt` arrives.
- Add `GET /v1/feeds/posts.rss` and `.atom`.

### Additional Requirements

- Sanitization runs on write and is verified on read (defence in depth). Include XSS payload tests.

### Acceptance Criteria

- The XSS payload suite is stripped.
- Scheduled posts publish on time (fake timers test).
- Feeds validate against the RSS spec.

---

## B-39 Backend — Fiat on/off-ramp integration (SEP-24) with reconciliation

**Labels:** `backend`, `complex`

### Description

Users without crypto need to buy the premium asset (e.g. USDC) with fiat. Integrate one or more SEP-24 anchors: start interactive deposit and withdraw flows, track `RampTransaction` status, and monitor provider health.

### Tasks

- Add `POST /v1/ramp/deposit` and `/withdraw`, which return the anchor's interactive URL.
- Add a status poller or callback handler that updates `RampTransaction`.
- Add a provider health check job (`RampProviderHealth`), and hide unhealthy providers.
- Add a reconciliation job that flags transactions stuck longer than a threshold.

### Additional Requirements

- Put the whole feature behind a feature flag, and document the anchors' compliance requirements per region.

### Acceptance Criteria

- Tests with a mocked anchor cover each status transition, the health toggle and stuck-transaction detection.

---

## B-40 Backend — Maintenance jobs: solvency monitor, retention, pin checks, privacy requests

**Labels:** `backend`, `security`, `devops`

### Description

Background jobs keep the system healthy and compliant. They monitor the on-chain solvency ratio, enforce data retention, verify IPFS pins still exist, and process user privacy requests (export and delete).

### Tasks

- Solvency monitor: read the treasury and reserved coverage from the contract, alert below warning and critical thresholds, and expose a metric.
- Data retention: purge or anonymize per-table records past their retention period (configurable, and documented per table).
- Pin check: sample evidence CIDs, re-pin missing ones, alert on failure.
- Privacy: `POST /v1/privacy/requests` (export or delete). Export produces a JSON bundle with a signed download link. Delete anonymizes off-chain personal data and explains that on-chain data is immutable.

### Additional Requirements

- Each job holds a distributed lock, has a metric and an alert, and is idempotent.

### Acceptance Criteria

- Tests per job, and an end-to-end privacy export and delete test.

---

## B-41 Backend — Claim discussion comments

**Labels:** `backend`

### Description

Voters and claimants can discuss a claim publicly (asking for clarification, pointing at evidence). Comments are threaded one level deep, rate-limited and moderatable.

### Tasks

- Add `GET` and `POST /v1/claims/:id/comments`, `DELETE` (author within 10 minutes, or a moderator), and `POST /:commentId/report`.
- Only the claimant and snapshotted voters may post. Anyone may read.
- Store comment bodies as plain text with a length limit.
- Push new comments over the live event stream.

### Additional Requirements

- Comments close when the claim is finalized, with appeal exceptions documented.

### Acceptance Criteria

- Tests: posting permissions, edit window, report flow, closed claim.

---

## B-42 Backend — Governance and voter registry API

**Labels:** `backend`

### Description

Expose governance state from indexed events: registered voters, delegations, and proposals with tallies. Provide transaction builders for proposal creation, proposal voting and vote delegation.

### Tasks

- Add `GET /v1/governance/voters` (paginated, admin), `GET /v1/governance/delegations/:address`, `GET /v1/governance/proposals` and `GET /v1/governance/proposals/:id`.
- Add `POST` builders for `create_proposal`, `vote_proposal`, `delegate_vote` and `revoke_vote_delegation`.
- Show the proposer cooldown remaining in the response.

### Additional Requirements

- Proposal payloads are validated with the same rules the contract uses, before building.

### Acceptance Criteria

- Tests for each endpoint and the validation errors.

---

## B-43 Backend — OpenAPI spec generation and experimental endpoint gating

**Labels:** `backend`, `docs`

### Description

`backend/openapi.json` is committed and consumed by the frontend for typed clients. Generate it from code with `@nestjs/swagger`, serve Swagger UI in non-production environments, and fail CI when the committed spec is stale. Experimental endpoints (e.g. XDR decode, beta calculators) live under `/v1/experimental`, behind a flag and access logging.

### Tasks

- Add Swagger decorators on all DTOs and controllers, plus a `npm run openapi:generate` script.
- Add a CI check that regenerates the spec and diffs it against the committed file.
- Add an experimental module with a feature-flag guard and an interceptor that logs each access.

### Additional Requirements

- Swagger UI is disabled in production, or protected by admin auth.

### Acceptance Criteria

- The spec is generated, and CI fails on drift.
- Experimental routes return 404 when the flag is off.

---

## B-44 Backend — Test infrastructure and legacy test triage

**Labels:** `backend`, `testing`

### Description

`backend/test/`, `backend/tests/` and `backend/loadtests/` still contain tests written against the deleted code. The rebuild needs reliable unit, integration and E2E layers with real Postgres and Redis in CI, and a decision on each legacy test.

### Tasks

- Configure Jest projects for `unit` (fast, mocked), `integration` (Testcontainers Postgres and Redis) and `e2e` (the full app).
- Add test data factories and a DB reset helper per test file.
- Triage every legacy test file (keep, rewrite or delete) and record the decision table in the PR.
- Merge or remove the duplicate `test/` and `tests/` folders so there is one convention.
- Add a coverage threshold (e.g. 80% lines on services) enforced in CI.
- Keep the k6 load tests in `loadtests/` runnable against staging, with documented thresholds.

### Additional Requirements

- Tests must be parallel-safe (isolated schemas or databases per worker).

### Acceptance Criteria

- `npm test` runs all layers green on a clean checkout with Docker available.
- CI enforces the coverage threshold.

---

## B-45 Backend — Container image, docker-compose and CI/CD pipeline

**Labels:** `backend`, `devops`

### Description

Ship the backend as a small, secure container, run the full stack locally with docker-compose, and deploy through CI. `backend/Dockerfile`, `backend/docker-compose.yml` and the root compose files exist from the old build and must be reviewed.

### Tasks

- Use a multi-stage Dockerfile: install, build, prune dev dependencies, then a distroless or alpine runtime running as a non-root user with a healthcheck.
- Use separate process roles from the same image: `api`, `worker` (queues) and `indexer`, selected by env or command.
- Update docker-compose to run Postgres, Redis, the API, the worker, the indexer and an optional local Stellar quickstart.
- Add a CI workflow: lint, typecheck, test, build image, scan it (Trivy), and push on `main`.
- Add a staging data sync job that anonymizes production data before loading it into staging, with rules documented.

### Additional Requirements

- The image has no secrets baked in, and target size is under 250 MB.

### Acceptance Criteria

- `docker compose up` gives a working stack from a clean clone, following the README steps.
- CI builds and scans the image on every PR.


---

# Frontend (F-01 – F-45)

## F-01 Frontend — Bootstrap the Next.js App Router project

**Labels:** `frontend`, `foundation`

### Description

`frontend/src` is empty. Create the minimal App Router structure (`src/app/layout.tsx`, `src/app/page.tsx`, global styles, path aliases) so the project builds and passes the existing quality gates (`lint`, `typecheck`, `build`).

### Tasks

- Create `src/app/layout.tsx` (html/body, font loading via `next/font`, metadata defaults) and a placeholder `src/app/page.tsx`.
- Create `src/styles/globals.css` with Tailwind layers, wired to `tailwind.config.ts`.
- Verify `tsconfig.json` paths (`@/*` → `src/*`) and strict mode, and `next.config.mjs` (security headers, `reactStrictMode`, image domains).
- Set the folder conventions: `app/`, `features/<feature>/{components,hooks,api}`, `components/ui`, `lib/`, `styles/`. Document them in `frontend/README.md`.
- Review `package.json` scripts and remove scripts that point at deleted files.

### Additional Requirements

- `npm run lint` fails on warnings, as the README states. Keep it that way.

### Acceptance Criteria

- `npm run lint`, `npm run typecheck` and `npm run build` all pass on a clean checkout.
- The home route renders.

---

## F-02 Frontend — Design tokens, theming and dark mode

**Labels:** `frontend`, `foundation`, `ux`

### Description

Define the visual language once: color, spacing, radius, typography and shadow tokens as CSS variables consumed by Tailwind, with light and dark themes that follow the system setting and can be toggled manually.

### Tasks

- Define CSS variables in `globals.css` for `--background`, `--foreground`, `--primary`, `--muted`, `--destructive`, `--success`, `--warning`, `--border`, `--ring`, and more.
- Map them in `tailwind.config.ts` (`colors.primary = 'hsl(var(--primary))'`, etc.).
- Add a `ThemeProvider` and a toggle with no flash of the wrong theme (inline script in the head).
- Add a token reference page in Storybook.

### Additional Requirements

- All text/background token pairs meet WCAG AA contrast in both themes (checked in a test or script).

### Acceptance Criteria

- The theme toggle persists and the system default works.
- The contrast check passes.

---

## F-03 Frontend — Core UI primitives (`components/ui`)

**Labels:** `frontend`, `foundation`, `a11y`

### Description

Build the shared, accessible primitives every feature uses: Button, Input, Textarea, Label, Select, Dialog, AlertDialog, Toast, Card, Badge, Skeleton, Tabs, Tooltip and Spinner. Use Radix UI, `class-variance-authority` and `tailwind-merge`, following Shadcn conventions.

### Tasks

- Implement each component with `cva` variants (size, intent) and forwarded refs.
- Add a `cn()` helper in `lib/utils.ts`.
- Add a Storybook story for each primitive covering all variants and states (disabled, loading, error).
- Add unit tests for keyboard interaction on Dialog, Select and Tabs.

### Additional Requirements

- Every interactive primitive is fully keyboard operable, with a visible focus ring.

### Acceptance Criteria

- Stories exist for all primitives.
- An axe check has no violations in the Storybook test runner.

---

## F-04 Frontend — App shell: header, navigation, footer and layout

**Labels:** `frontend`, `ux`

### Description

Create the persistent app chrome: a responsive header with logo, main navigation (Dashboard, Policies, Claims, Governance, Docs, Support) and a wallet button slot, a mobile nav drawer, a footer with legal links, and a skip-to-content link.

### Tasks

- Add `components/nav/Header.tsx`, `MobileNav.tsx` and `Footer.tsx`, and `app/(app)/layout.tsx` using them.
- Highlight the active route, with `aria-current`.
- Add a placeholder wallet button area that renders children.

### Additional Requirements

- The mobile drawer traps focus and closes on Escape and on route change.

### Acceptance Criteria

- The layout is responsive from 320px to desktop.
- Keyboard navigation through the nav works, and the skip link works.

---

## F-05 Frontend — Internationalization with `next-intl`

**Labels:** `frontend`, `ux`

### Description

The app supports multiple locales (see `frontend/messages/` and `LOCALES.md`). Set up `next-intl` with locale-prefixed routing, locale detection, and typed message keys.

### Tasks

- Add `src/i18n/` config and request handler, and `middleware.ts` for locale negotiation and redirects.
- Move routes under `app/[locale]/`.
- Add a type-safe `useTranslations` with message key autocomplete, and a CI check for missing keys across locales.
- Add a locale switcher component that keeps the current path.
- Format dates, numbers and currency by locale.

### Additional Requirements

- Review the existing `messages/*.json` files and remove keys that belonged only to deleted UI.

### Acceptance Criteria

- Switching locale changes the text and URL.
- CI fails on a missing key.
- Bidirectional (RTL) layout works if an RTL locale is listed.

---

## F-06 Frontend — Typed environment variables and server-only guard

**Labels:** `frontend`, `security`

### Description

Browser code must never read server secrets. Create `lib/env.ts` (zod-validated `NEXT_PUBLIC_*` values) and `lib/env.server.ts` (server-only values, protected by `import 'server-only'`), and a `lib/server-guard.ts` as the README describes.

### Tasks

- Validate at build and startup, and fail fast with the list of invalid keys.
- Export typed config: API base URL, network, contract ids, explorer URL, feature defaults.
- Update `.env.example` so it matches the schema.

### Additional Requirements

- Add an ESLint rule to block `process.env` outside the env modules.

### Acceptance Criteria

- The build fails if a required public variable is missing.
- Importing the server env from a client component fails the build.

---

## F-07 Frontend — API client with typed endpoints and error mapping

**Labels:** `frontend`, `foundation`

### Description

All backend calls go through one client in `lib/api/`: base URL from env, JSON handling, auth header injection, request ids, timeouts, and mapping of the backend error envelope to a typed `ApiError { code, message, details }`.

### Tasks

- Add `apiFetch<T>(path, options)` with an `AbortController` timeout and retry on idempotent GET only.
- Generate TypeScript types from `backend/openapi.json` (e.g. `openapi-typescript`) and use them for request and response types.
- Map error codes to translated user messages, with a fallback.
- Add a token refresh-on-401 flow, run once, with request queuing.

### Additional Requirements

- The client is usable from both server and client components.

### Acceptance Criteria

- Unit tests with MSW cover success, error envelope, timeout, 401 refresh and retry rules.

---

## F-08 Frontend — React Query setup and query key conventions

**Labels:** `frontend`, `foundation`, `performance`

### Description

Configure TanStack Query as the server-state layer: a provider with sensible defaults, a query key factory per feature, SSR hydration for server-rendered pages, and devtools in development.

### Tasks

- Add `lib/query/client.ts` (defaults: `staleTime`, retry that skips 4xx, `refetchOnWindowFocus` per query), and a `QueryProvider`.
- Add `lib/query/keys.ts` with a factory (e.g. `policyKeys.list(filters)`, `claimKeys.detail(id)`).
- Add a hydration helper for prefetching in server components.

### Additional Requirements

- Document when to use Query versus local state versus URL state.

### Acceptance Criteria

- An example query is prefetched on the server and hydrated on the client without a refetch (tested).

---

## F-09 Frontend — Stellar wallet connection with multiple wallets

**Labels:** `frontend`, `foundation`, `complex`

### Description

Users connect Freighter, xBull, Albedo, Lobstr or other wallets through `@creit.tech/stellar-wallets-kit`. Provide a wallet context (address, network, connection state) and a connect button with a wallet picker.

### Tasks

- Add a `features/wallet/` provider, `useWallet()` hook, `ConnectWalletButton` and `WalletMenu` (copy address, view on explorer, disconnect).
- Persist the last used wallet and reconnect silently on load.
- Detect a network mismatch (the wallet is on mainnet while the app is on testnet) and show a blocking banner with instructions.
- Show a truncated address with a full-address tooltip.

### Additional Requirements

- Never request signing on connect. Connecting only reads the public key.

### Acceptance Criteria

- Tests with a mocked kit cover connect, reconnect, disconnect and mismatch banner.

---

## F-10 Frontend — Wallet sign-in session (challenge → sign → JWT)

**Labels:** `frontend`, `security`

### Description

After connecting, the user signs a challenge to authenticate with the backend. Manage the session: store the access token in memory (the refresh token is an httpOnly cookie set by the backend), handle expiry, and sign out when the wallet account changes.

### Tasks

- Add a `useSession()` hook with `signIn()`, `signOut()`, `status` and `address`.
- Build the sign-in flow UI: an explainer modal ("Signing proves you own this wallet; it costs nothing"), a loading state, and an error state.
- Sign out automatically and clear the query cache when the wallet's address changes.
- Add route protection for authenticated pages, with a redirect back after sign-in.

### Additional Requirements

- Never persist the access token to `localStorage`.

### Acceptance Criteria

- Tests: sign-in success, user rejects signature, expiry → refresh, account switch → sign out.

---

## F-11 Frontend — Transaction lifecycle hook: build, sign, submit, confirm

**Labels:** `frontend`, `complex`

### Description

Every on-chain action (buy, file claim, vote, appeal, renew) follows the same flow: get unsigned XDR from the backend, sign in the wallet, submit, and wait for confirmation. Build one reusable hook and one reusable status UI for it.

### Tasks

- Add `useContractTx({ build, onSuccess })` with states `idle → building → awaiting-signature → submitting → confirming → success | error`.
- Add a `TxStatusDialog` showing each step, the explorer link on success, and a retry on failure.
- Map errors: user rejected, insufficient balance, simulation failed (contract error code → message), timeout.
- Invalidate the relevant queries on success.

### Additional Requirements

- Closing the dialog mid-flow never loses a submitted transaction. Keep tracking it in the background and notify on completion.

### Acceptance Criteria

- Unit tests cover every state transition and error class.
- A Storybook story shows each state.

---

## F-12 Frontend — Amount and asset formatting utilities

**Labels:** `frontend`, `good-first-issue`

### Description

On-chain amounts are integers in the asset's smallest unit (stroops for 7 decimals). Display and input must convert exactly, with no floating-point errors. Use `big.js`.

### Tasks

- Add `lib/amount.ts` with `toDisplay(raw: string | bigint, decimals, opts)`, `toRaw(input: string, decimals)` (strict parse, rejects too many decimals), `formatAsset(raw, asset, locale)`, and compact notation for large numbers.
- Add an `AmountInput` component that restricts input to valid decimals and shows the balance with a "max" button.

### Additional Requirements

- Never use `Number` for amounts. Add a lint or test guard.

### Acceptance Criteria

- Property tests: `toRaw(toDisplay(x)) === x` for random values.
- Locale formatting is tested for at least two locales.

---

## F-13 Frontend — Shared zod schemas for forms and API payloads

**Labels:** `frontend`

### Description

Forms and API payloads share validation rules (addresses, amounts, coverage ranges, evidence limits). Centralize them in `lib/schemas/`, so client validation matches backend and contract rules.

### Tasks

- Add schemas for Stellar address (StrKey), amount strings, the risk input, the policy purchase payload, the claim filing payload, and profile updates.
- Use translated error messages via an i18n error map.
- Use them with `@hookform/resolvers/zod` in forms.

### Additional Requirements

- Document each limit's source (contract constant or backend config) next to the schema.

### Acceptance Criteria

- Unit tests with valid and invalid fixtures for every schema.

---

## F-14 Frontend — Landing page

**Labels:** `frontend`, `ux`

### Description

The public home page explains niffyInsure: decentralized insurance on Stellar, how claims are voted on by policyholders, supported coverage types, and a call to action to get a quote. It must be fast and SEO friendly.

### Tasks

- Add `components/landing/`: a hero, a "how it works" section (buy → file → community votes → payout), coverage types, trust and transparency stats (live from the API with a fallback), an FAQ preview and a CTA.
- Render it as a server component with static generation and revalidation for stats.
- Add metadata, Open Graph image and structured data.

### Additional Requirements

- Lighthouse performance and accessibility of 90 or more on mobile.

### Acceptance Criteria

- The page renders without JavaScript for its core content.
- Lighthouse scores are recorded in the PR.

---

## F-15 Frontend — Quote page with risk form and live premium

**Labels:** `frontend`, `ux`

### Description

Users enter their risk profile (policy type, region, age band, coverage tier, safety score, coverage amount, asset) and see a premium quote from the backend. The form is shareable through URL params.

### Tasks

- Add `app/[locale]/quote/page.tsx` and `features/quote/`: a form using react-hook-form and zod, a debounced quote query, and a result card with the premium, coverage, deductible note and expiry countdown.
- Show clear messages for quote errors (e.g. coverage below the minimum).
- Add a "Continue to purchase" button that carries the quote inputs into the purchase flow.

### Additional Requirements

- The form is fully usable with a keyboard and screen reader. Labels, descriptions and errors are linked with `aria-describedby`.

### Acceptance Criteria

- Tests: validation, debounced request, error display, URL state round trip.

---

## F-16 Frontend — Policy purchase wizard

**Labels:** `frontend`, `complex`, `ux`

### Description

This is the multi-step purchase: 1) confirm quote, 2) options (beneficiary, deductible, duration), 3) review terms (show the terms document and its hash), 4) sign and pay. It needs a connected, signed-in wallet with enough balance of the chosen asset.

### Tasks

- Add `features/purchase-wizard/` with a step state machine, a progress indicator, and back and next navigation that preserves data.
- Check the balance and trustline before the sign step. Link to the fiat ramp when funds are insufficient.
- Use the shared transaction lifecycle for signing, then show a success page with the policy id and next steps.
- Persist the draft to `sessionStorage` so a refresh doesn't lose progress.

### Additional Requirements

- The terms acceptance checkbox is required, and the accepted terms hash is sent with the transaction.

### Acceptance Criteria

- Tests: step validation, back navigation keeps data, insufficient balance path, success path (mocked transaction).

---

## F-17 Frontend — Policies list page

**Labels:** `frontend`

### Description

`/policies` shows the signed-in holder's policies with status (active, grace, expired, terminated), coverage, asset, expiry countdown and open-claim indicator, with filters and pagination.

### Tasks

- Add `app/[locale]/policies/page.tsx` and a `PolicyCard` or table row component (card on mobile, table on desktop).
- Add filters for status, type and asset, synced to the URL. Use cursor pagination with a "load more" button.
- Add an empty state with a CTA to get a quote, and loading skeletons.

### Additional Requirements

- Status badges use both color and text (not color alone).

### Acceptance Criteria

- Tests: filters update the URL and query, empty state, pagination.

---

## F-18 Frontend — Policy detail page

**Labels:** `frontend`

### Description

`/policies/[id]` shows the full policy: holder, type, region, coverage, premium, deductible, beneficiary, asset, start and end (ledger and estimated date), terms document link and hash, claim history for the policy, and available actions (file claim, renew, transfer, set beneficiary, terminate).

### Tasks

- Show each action only when it is allowed, with an explanation when disabled (e.g. "Renewal opens 30 days before expiry").
- Add the beneficiary and transfer forms, with address validation and a confirmation dialog that shows the consequences.
- Add a termination confirmation that explains the refund rules.

### Additional Requirements

- Every action uses the shared transaction flow.

### Acceptance Criteria

- Tests: action visibility per policy state, form validation, confirmation dialogs.

---

## F-19 Frontend — Policy renewal page

**Labels:** `frontend`

### Description

`/policies/[id]/renew` shows a fresh renewal quote (it may differ from the original premium), the new coverage period, and a sign-and-pay flow.

### Tasks

- Compare the old and new premium, and explain why the price changed (e.g. table update).
- Show a grace period warning when applicable.
- Show a success state that links back to the policy.

### Additional Requirements

- Block renewal with a clear message when the policy has an open claim or is not eligible.

### Acceptance Criteria

- Tests: eligible, ineligible and grace period states.

---

## F-20 Frontend — User dashboard

**Labels:** `frontend`, `ux`

### Description

`/dashboard` is the signed-in home: active policies summary, claims in progress, claims awaiting the user's vote (with deadlines), upcoming renewals, recent notifications, and quick actions.

### Tasks

- Add `components/dashboard/` widgets. Each fetches independently with its own loading and error boundary.
- Show a "votes needed" widget with a countdown and a link to the vote panel.
- Add an onboarding checklist for new users (connect wallet, get quote, buy policy).

### Additional Requirements

- A failing widget never breaks the whole page.

### Acceptance Criteria

- Tests: each widget renders loading, error, empty and data states.

---

## F-21 Frontend — Claims list page

**Labels:** `frontend`

### Description

`/claims` has two tabs: "My claims" (claims the user filed) and "Community claims" (all public claims, for voters). It supports filters (status, date, asset), search, and pagination.

### Tasks

- Add `app/[locale]/claims/page.tsx` with tab and URL state.
- Add a `ClaimRow` showing id, policy, amount, status badge, vote progress bar and deadline.
- Highlight claims awaiting the current user's vote.

### Additional Requirements

- Search input is debounced and cancels in-flight requests.

### Acceptance Criteria

- Tests: tab switching, filters and search, vote-needed highlight.

---

## F-22 Frontend — File a claim with evidence upload

**Labels:** `frontend`, `complex`, `ux`

### Description

The claim filing form: select a policy, enter the amount (validated against coverage), describe the incident (character counter), and upload evidence files with progress. Then review and sign.

### Tasks

- Add a drag-and-drop uploader with per-file progress, type and size validation before upload, retry on failure, and removal.
- Show each uploaded file's hash and IPFS link in the review step.
- Enforce minimum and maximum evidence counts, and show the filing fee before signing.
- Keep a draft in `sessionStorage`, excluding files.

### Additional Requirements

- Warn users that images are stripped of location metadata, and that evidence is public on IPFS.

### Acceptance Criteria

- Tests: validation, upload progress (mocked), review content, sign flow.

---

## F-23 Frontend — Claim detail page with timeline and evidence viewer

**Labels:** `frontend`

### Description

`/claims/[claimId]` shows the claim's status, amount, deductible, net payout, description, evidence gallery (images inline, PDFs as links, hash verification indicator) and a timeline (filed → votes → finalized → appeal → paid).

### Tasks

- Add an evidence viewer with a lightbox and keyboard navigation.
- Add client-side hash verification: fetch the file, compute SHA-256, and show verified or mismatch.
- Show a status-specific explanation banner (e.g. "Rejected — you may appeal until …").
- Keep this as the single live claim-detail component. Do not create duplicates.

### Additional Requirements

- Evidence from non-allowlisted gateways is not auto-loaded.

### Acceptance Criteria

- Tests: every status renders the right banner, the hash verification states, the timeline order.

---

## F-24 Frontend — Claim voting panel

**Labels:** `frontend`, `ux`

### Description

Eligible voters approve or reject a claim from the claim detail page. The panel shows eligibility, the current tally, quorum progress, and a deadline countdown, and it disables itself with a reason when the user can't vote.

### Tasks

- Add a vote panel component with Approve and Reject buttons and a confirmation dialog summarizing the claim.
- Explain ineligibility: not in the snapshot, own claim, already voted, deadline passed.
- Show an optimistic tally update on success, then reconcile with the server.

### Additional Requirements

- Buttons must not be accidentally double-submittable.

### Acceptance Criteria

- Tests: each eligibility state, confirmation, double-click protection.

---

## F-25 Frontend — Commit-reveal voting UI

**Labels:** `frontend`, `complex`, `security`

### Description

When a claim uses commit-reveal mode, the user commits a hidden vote, then must return during the reveal window to reveal it. The salt must be generated securely and kept safe until reveal.

### Tasks

- Generate the salt with `crypto.getRandomValues`, and compute the commitment hash client-side, matching the contract's preimage format.
- Store the salt and vote locally (IndexedDB) and offer a downloadable backup file.
- Show reveal reminders on the dashboard and claim page during the reveal window, with a one-click reveal.
- Explain what happens if the vote is not revealed.

### Additional Requirements

- The salt never leaves the browser before reveal. It is never sent to the backend.

### Acceptance Criteria

- Unit test: the commitment hash matches contract test vectors.
- Tests: reveal flow, lost-salt recovery from the backup file.

## F-26 Frontend — Appeals UI: appeal button, confirmation and appeal voting

**Labels:** `frontend`, `ux`

### Description

A claimant whose claim was rejected can appeal within the appeal window. Appeal voters then vote in a fresh round. Build the claimant side (appeal button, confirmation modal) and the voter side (appeal vote panel).

### Tasks

- Add an `AppealButton`, visible only to the claimant, with a window countdown, and an `AppealConfirmModal` explaining the elevated quorum, the one-appeal limit and the timeline.
- Add an appeal voting panel that reuses the vote panel patterns.
- Add a post-appeal success state whose explorer link matches the other transaction success states.
- Add Storybook stories for default, submitting, error and hidden (non-claimant) states.

### Additional Requirements

- Hide the button entirely for non-claimants. Don't show it disabled.

### Acceptance Criteria

- Tests: visibility rules, window expiry, success and error states.

---

## F-27 Frontend — Claim discussion thread

**Labels:** `frontend`

### Description

Below a claim, show a comment thread (one level of replies) where the claimant and eligible voters can post, and anyone can read. Support reporting and author deletion within the edit window.

### Tasks

- Add `components/discussion/`: a list, a composer with a character count, replies, report and delete actions.
- New comments appear live through the event stream.
- Render comments as plain text with auto-linked URLs (`rel="noopener noreferrer nofollow"`).

### Additional Requirements

- Never render comment content as HTML.

### Acceptance Criteria

- Tests: permissions (who sees the composer), an XSS string rendered inert, live insert.

---

## F-28 Frontend — Live updates via Server-Sent Events

**Labels:** `frontend`, `performance`

### Description

Subscribe to the backend event stream to update claim tallies, statuses and transaction confirmations live, by patching the React Query cache.

### Tasks

- Add an `useEventStream()` provider that fetches a stream token, opens an `EventSource`, and reconnects with backoff and `Last-Event-ID`.
- Add typed event handlers that call `queryClient.setQueryData` or invalidate the matching keys.
- Pause the connection when the tab is hidden for a long time, and resume on focus.

### Additional Requirements

- One connection per tab, shared by all components.

### Acceptance Criteria

- Tests with a mocked `EventSource`: reconnect, cache patching, visibility pause.

---

## F-29 Frontend — Optimistic update utilities

**Labels:** `frontend`

### Description

Actions such as voting, commenting and marking notifications read should feel instant. Provide helpers in `lib/optimistic/` that apply an optimistic cache change, roll back on error, and reconcile on success.

### Tasks

- Add an `optimisticMutation({ queryKey, apply, rollback })` wrapper for `useMutation`.
- Show a rollback toast with the error message.
- Apply it to at least notifications and comments in this issue.

### Additional Requirements

- On-chain actions show an optimistic "pending" state only. Final numbers always come from confirmed data.

### Acceptance Criteria

- Tests: apply, rollback on error, reconcile on success.

---

## F-30 Frontend — Governance proposals page

**Labels:** `frontend`

### Description

`/governance` lists protocol proposals (open, passed, rejected, executed) with tallies and deadlines. Voters can create proposals and vote on them.

### Tasks

- Add a proposal list and detail with a vote panel, and a create-proposal form with a typed payload editor per proposal kind (e.g. quorum bps input with validation).
- Show the proposer cooldown remaining, and disable creation with an explanation during the cooldown.
- Show the current parameter value next to the proposed one.

### Additional Requirements

- Client-side payload validation matches the contract's limits.

### Acceptance Criteria

- Tests: creation validation, cooldown state, voting.

---

## F-31 Frontend — Vote delegation UI

**Labels:** `frontend`

### Description

Voters can delegate their claim-voting power to another voter until an expiry date, see who delegates to them, and revoke delegation.

### Tasks

- Add a delegation card in governance or settings: current delegate, expiry, revoke button.
- Add a delegate form with address validation, an expiry picker (converted to a ledger estimate) and a confirmation.
- Show a "Delegated to you" list.

### Additional Requirements

- Explain that voting directly overrides the delegation for that claim.

### Acceptance Criteria

- Tests: form validation, revoke, expiry display.

---

## F-32 Frontend — Transaction history page

**Labels:** `frontend`

### Description

`/transactions` shows the user's on-chain activity with the insurance contract (purchases, claims, votes, payouts, renewals) with human-readable labels, amounts, status and explorer links.

### Tasks

- Add a paginated list with a type filter and date grouping.
- Map contract operations to friendly labels and icons.
- Show pending transactions (tracked locally) at the top until they confirm.

### Additional Requirements

- Every row links to the relevant policy or claim when applicable.

### Acceptance Criteria

- Tests: label mapping for each operation type, pending merge, pagination.

---

## F-33 Frontend — Settings: profile and notification preferences

**Labels:** `frontend`, `ux`

### Description

`/settings` lets users edit their profile (display name, email with verification, locale) and `/settings/notifications` lets them choose which events notify them on which channel, plus quiet hours and digest mode.

### Tasks

- Add a profile form with validation and a "verify email" flow state.
- Add a notification matrix (event × channel) of toggles with an accessible table structure, and quiet hours pickers.
- Add an in-app notification bell in the header, with an unread count and dropdown list.

### Additional Requirements

- Save changes with clear success and error feedback. No silent failures.

### Acceptance Criteria

- Tests: form validation, matrix toggles saved, unread count updates.

---

## F-34 Frontend — Support center: tickets, FAQ and error code reference

**Labels:** `frontend`

### Description

`/support` provides a searchable FAQ, a "contact us" ticket form (captcha when not signed in), and a list of the user's tickets. `/support/tickets/[id]` shows the conversation. `/support/error-codes` lists every error code with explanations and fixes.

### Tasks

- Add FAQ search and accordion, with "was this helpful?" buttons.
- Add a ticket form that can link a claim or policy, with a captcha widget.
- Add a ticket thread view with a reply composer.
- Build the error code page from the backend error catalog, with deep links (`#CODE`) that the transaction error dialog links to.

### Additional Requirements

- Ticket content renders as plain text.

### Acceptance Criteria

- Tests: FAQ search, form validation, error code deep link scrolls to the entry.

---

## F-35 Frontend — Documentation section (MDX)

**Labels:** `frontend`, `docs`

### Description

`/docs` explains the protocol to users: how claims work, voting and quorum, the treasury and solvency, and contract addresses per network. Content is MDX, rendered with `next-mdx-remote`, with a sidebar and table of contents.

### Tasks

- Add a content folder with MDX pages: `index`, `claims`, `voting`, `treasury`, `contracts`.
- Add a docs layout with a sidebar, per-page table of contents, previous and next links, and "edit on GitHub".
- Add custom MDX components: callouts, and a contract address block with copy and explorer link, read from env per network.
- Statically generate every docs page.

### Additional Requirements

- MDX is authored in-repo only. Never render remote MDX from user input.

### Acceptance Criteria

- All pages render statically, and the table of contents links work.

---

## F-36 Frontend — Privacy page and privacy request flow

**Labels:** `frontend`, `security`

### Description

`/privacy` shows the privacy policy and lets signed-in users request a data export or deletion, with a clear explanation that on-chain data cannot be deleted.

### Tasks

- Show the privacy policy content (MDX).
- Add request forms with a confirmation, request status tracking, and an export download link when ready.
- Add a cookie and analytics consent banner, if analytics are used.

### Additional Requirements

- Deletion requires re-authentication (sign a fresh challenge).

### Acceptance Criteria

- Tests: request flows, status display, re-auth required for deletion.

---

## F-37 Frontend — Admin area layout and access control

**Labels:** `frontend`, `security`

### Description

`/admin/*` is available only to wallets with the admin, operator or support role. Build the admin layout (sidebar, role badge, environment indicator) and route protection on both server and client.

### Tasks

- Add `app/[locale]/admin/layout.tsx` with a server-side role check that redirects unauthorized users.
- Filter the sidebar by role.
- Add a large, colored environment banner: "TESTNET" or "MAINNET".

### Additional Requirements

- Client-side hiding is not security. Every admin API call is still authorized by the backend. Document this in code comments.

### Acceptance Criteria

- Tests: non-admin redirected, sidebar filtered per role.

---

## F-38 Frontend — Admin dashboard with stats and charts

**Labels:** `frontend`

### Description

`/admin` shows protocol health: total and active policies, active coverage, premiums collected, claims by status, payouts, solvency ratio with thresholds, indexer lag, and time series charts.

### Tasks

- Add stat tiles and charts, using an accessible, lightweight charting approach.
- Add a range selector (7, 30 or 90 days, all) synced to the URL.
- Show a solvency gauge with warning and critical colors plus text labels.

### Additional Requirements

- Every chart has a data table alternative for screen readers.

### Acceptance Criteria

- Tests: tiles render API data, range switching, accessible table present.

---

## F-39 Frontend — Admin claims management

**Labels:** `frontend`

### Description

`/admin/claims` lets operators search claims, view fraud scores, dispute or escalate claims, process payouts for approved claims, and export CSV.

### Tasks

- Add a table with filters (status, fraud score range, asset, date) and bulk selection for payout processing.
- Add action dialogs for dispute, escalate and process payout, each explaining consequences and requiring a typed confirmation for destructive actions.
- Add a CSV export button that downloads the streamed export.

### Additional Requirements

- Bulk payout shows per-claim results. Partial failure must be visible.

### Acceptance Criteria

- Tests: filters, confirmation requirements, per-item bulk results.

---

## F-40 Frontend — Admin configuration: assets, feature flags and pause controls

**Labels:** `frontend`, `security`

### Description

Admins manage the allowed assets list, feature flags (boolean, percentage, allowlist), and contract pause state (global, bind, claims) with a reason.

### Tasks

- Add an assets page: list, add or edit (code, issuer, contract id, decimals), and a mismatch warning when the backend and contract allowlists differ.
- Add a flags page with an editor per flag type.
- Add a pause control panel showing the current flags and reason, with pause and unpause actions using the transaction flow and a typed confirmation.

### Additional Requirements

- Pause actions show a prominent warning about user impact.

### Acceptance Criteria

- Tests: forms, mismatch warning, pause confirmation.

---

## F-41 Frontend — Admin governance: voters, delegations and audit log

**Labels:** `frontend`

### Description

Admin pages for the voter registry (search, remove voter with reason), operator delegations (grant scopes with expiry, revoke), and the admin audit log (filterable, with diff view).

### Tasks

- Add `/admin/governance/voters`, `/admin/delegations` and `/admin/audit`.
- Add a scope picker with descriptions of each scope.
- Add an audit log table with actor, action, target and time, and a JSON diff viewer.

### Additional Requirements

- Removing a voter requires a reason and a confirmation.

### Acceptance Criteria

- Tests for each page's main flow.

---

## F-42 Frontend — Admin content: FAQ and announcements

**Labels:** `frontend`

### Description

Admins manage FAQ entries and announcement posts (draft, scheduled or published) with a Markdown editor and preview.

### Tasks

- Add `/admin/faq` (CRUD, ordering, helpfulness stats) and `/admin/posts` (editor, preview, schedule picker, status).
- Render previews with the same sanitizer rules as the public page.
- Show published announcements as a dismissible banner in the app shell.

### Additional Requirements

- Warn before leaving the editor with unsaved changes.

### Acceptance Criteria

- Tests: create, schedule and publish flow, preview sanitization, unsaved-changes warning.

---

## F-43 Frontend — Fiat on-ramp integration

**Labels:** `frontend`

### Description

Users without enough of the premium asset can buy it through a SEP-24 anchor. The ramp is launched from the purchase wizard and from the wallet menu, opens the anchor's interactive flow, and tracks status.

### Tasks

- Add `components/ramp/`: provider selection (healthy providers only), a launch in a popup or iframe per the anchor's requirements, and a status tracker.
- Refresh the balance when the deposit completes, then return the user to where they came from.
- Put it behind a feature flag.

### Additional Requirements

- Clearly show that a third party provides the service, with their terms link.

### Acceptance Criteria

- Tests with a mocked backend cover the provider list, status progression and flag off.

---

## F-44 Frontend — PWA support, onboarding tour and performance budget

**Labels:** `frontend`, `performance`, `ux`

### Description

Make the app installable and offline-tolerant (the shell and docs work offline), add a first-visit guided tour with `driver.js`, and enforce performance budgets.

### Tasks

- Configure `@ducanh2912/next-pwa`: manifest, icons, and a service worker that caches the shell and docs, never API responses with user data.
- Add an onboarding tour of the dashboard and purchase flow, which the user can skip and restart from settings.
- Add bundle analysis and a CI budget (e.g. under 200 KB JS on first load for key routes), with route-level code splitting for heavy components (charts, uploader, wallet kit).
- Add error boundaries, and `loading.tsx` and `not-found.tsx` for all route groups.

### Additional Requirements

- The service worker update flow prompts the user to reload. No stale app is served indefinitely.

### Acceptance Criteria

- Lighthouse PWA installable. The CI budget check runs.
- Offline shows the shell with an offline banner.

---

## F-45 Frontend — Testing infrastructure: unit, Storybook, E2E and legacy triage

**Labels:** `frontend`, `testing`

### Description

`frontend/tests/`, `frontend/e2e/`, `frontend/specs/` and `.storybook/` remain from the old build. Set up the rebuild's testing layers and decide the fate of each legacy test.

### Tasks

- Jest with React Testing Library: fix `jest.config.js` and `jest.setup.ts` for the new structure, and add MSW handlers generated from the OpenAPI types.
- Storybook: fix the config, and add the interaction and axe test runner to CI.
- Playwright: E2E suites for connect wallet (mocked wallet), quote → purchase, file claim, vote, appeal, run against a mocked backend or staging.
- Triage every legacy test file (keep, rewrite or delete) and record the decision table in the PR.
- Add CI jobs: lint, typecheck, unit (with a coverage threshold), Storybook tests, build, E2E on main.

### Additional Requirements

- E2E tests must not depend on real wallets or real funds.

### Acceptance Criteria

- All test layers run green in CI from a clean checkout.
- The legacy triage table is included in the PR.

