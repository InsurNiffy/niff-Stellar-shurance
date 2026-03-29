# niffyInsure — Additional Build Issues

---

## Contract — Governance token stub: reserve namespace without activating token logic

### Description

A future governance token may be introduced to complement or replace the tokenless DAO model. This item reserves the module namespace, storage keys, and type stubs so that when the design is finalized, integration does not require renaming live symbols or migrating storage layouts. All execution paths must be gated behind a compile-time feature flag or admin toggle that defaults to disabled, ensuring no token minting, transfer, or balance logic runs in production MVP builds.

### Tasks

- Add a `governance_token` module with stub types and storage key variants.
- Gate all non-stub logic behind `#[cfg(feature = "governance-token")]` or an admin-controlled runtime flag.
- Write tests asserting no token operations execute in default builds.
- Document the intended activation path and design prerequisites in a `TODO` comment block.

### Additional Requirements

- Do not introduce live token transfer calls until a full design review is complete.
- Keep stub code minimal to avoid maintenance burden.

### Acceptance Criteria

- Default builds compile and pass tests with zero governance token side effects.
- Feature-flagged builds compile in isolation without breaking the main suite.
- Namespace is reserved and documented for future engineers.

---

## Contract — Coverage tier enum: bounded risk categories replacing free-text fields

### Description

Free-text coverage tier fields create ambiguity in premium calculations, event parsing, and indexer schemas. Replacing them with a Soroban-compatible enum enforces a closed set of valid categories at the type level, eliminates string comparison bugs, and makes the ABI self-documenting. Every consumer—premium engine, event payloads, NestJS DTOs, Next.js display labels—benefits from a single authoritative definition.

### Tasks

- Define a `CoverageTier` enum with variants matching the product spec (e.g. `Basic`, `Standard`, `Premium`).
- Update `Policy` struct, premium engine input structs, and all event payloads to use the enum.
- Add validation helpers rejecting unknown or deprecated variants at entrypoint boundaries.
- Update unit tests and golden vectors to use enum variants.

### Additional Requirements

- Enum variants must serialize consistently with existing event schemas or a migration note must be filed.
- Document how new tiers are added in future contract versions without breaking deployed parsers.

### Acceptance Criteria

- No string-based tier fields remain in on-chain structs.
- Invalid tier inputs revert with clear errors in tests.
- Backend DTO and frontend label mappings are updated to match.

---

## Contract — Deductible model: per-policy deductible storage and claim-amount adjustment

### Description

A deductible reduces the net payout on an approved claim, aligning incentives and reducing frivolous filings. The deductible amount must be stored per policy at bind time, validated against coverage caps, and subtracted from `claim_amount` before any payout transfer. If the net amount after deductible is zero or negative, the claim should revert or resolve as zero-payout with a distinct status to avoid confusing users.

### Tasks

- Add an optional `deductible: i128` field to the `Policy` struct with validation at `initiate_policy`.
- Subtract deductible from `claim_amount` in the payout path; revert if net ≤ 0 with a clear error.
- Emit deductible amount in `ClaimFiled` and `ClaimProcessed` events for reconciliation.
- Add tests for zero deductible, partial deductible, and deductible exceeding claim amount.

### Additional Requirements

- Deductible must be denominated in the same asset as the premium and payout.
- Document interaction with coverage cap: deductible applies before or after cap per product spec.

### Acceptance Criteria

- Payout amounts in tests match expected net values after deductible subtraction.
- Zero-net-payout cases are handled without silent failures.
- Backend indexer can display deductible breakdown from event data.

---

## Contract — Grace period config: admin-settable ledger buffer for late renewals

### Description

A grace period allows policyholders a short window after nominal expiry to renew without a coverage gap. The duration must be admin-configurable within absolute bounds to accommodate product changes without redeployment. The renewal window check must apply the grace period consistently, and the Next.js countdown UI must reflect the same rules to avoid user confusion.

### Tasks

- Store `grace_period_ledgers: u32` in instance storage; admin setter with min/max bounds and an event.
- Apply grace period in the renewal eligibility check alongside the standard window.
- Add boundary tests: renewal at expiry ledger, at expiry + grace, and at expiry + grace + 1.
- Document the grace period in the renewal runbook and frontend countdown copy.

### Additional Requirements

- Grace period must not allow renewal while an open claim is active if that rule is enforced elsewhere.
- Emit `GracePeriodUpdated` event with old and new values.

### Acceptance Criteria

- Renewals within grace period succeed; renewals one ledger past grace revert.
- Admin updates are authenticated and logged.
- Frontend countdown documentation references the same ledger math.

---

## Contract — Claim evidence hash commitment: SHA-256 digest alongside URL

### Description

Storing only a URL for evidence creates a trust gap: the content at that URL can change after filing. Adding a SHA-256 content hash alongside each URL creates a tamper-evident commitment that auditors, voters, and the NestJS verification service can check against the actual file. The hash must be validated as non-zero at filing time and included in the `ClaimFiled` event.

### Tasks

- Extend the evidence entry type to `{ url: String, hash: BytesN<32> }`.
- Validate that each hash is non-zero at `file_claim`; revert otherwise.
- Emit the hash array in `ClaimFiled` for off-chain integrity checks.
- Add tests for zero-hash rejection and correct hash persistence.

### Additional Requirements

- Document that the contract cannot verify hash correctness on-chain; it only stores the commitment.
- Backend IPFS proxy should compute and return the hash for the frontend to pass through.

### Acceptance Criteria

- Evidence entries without valid hashes are rejected at filing.
- Hashes are readable via `get_claim` and present in events.
- Backend verification service can compare stored hash against fetched IPFS content.

---

## Contract — Voter snapshot TTL: expiry and refresh for DAO eligibility maps

### Description

Voter snapshots taken at claim filing can become stale if the protocol runs for extended periods or if Soroban storage TTLs cause entries to expire. This item defines explicit TTL semantics for snapshot entries, implements a refresh helper, and documents the operational procedure for keeping snapshots live during active voting periods. Stale snapshots must not silently allow ineligible voters or block eligible ones.

### Tasks

- Define TTL constants for snapshot storage entries; bump TTL on snapshot creation and refresh.
- Implement an admin or keeper `refresh_snapshot(claim_id)` entrypoint extending TTL.
- Add tests verifying that expired snapshots cause vote attempts to revert with a clear error.
- Document the expected refresh cadence relative to voting deadlines.

### Additional Requirements

- Align TTL values with Stellar protocol guidance for the target network.
- Keeper refresh must be permissionless to avoid admin bottlenecks during active votes.

### Acceptance Criteria

- Votes against expired snapshots revert with an actionable error.
- Refresh extends TTL without altering vote counts or eligibility sets.
- Operational runbook describes who monitors and triggers refreshes.

---

## Contract — Multi-sig admin pattern: two-step confirmation for high-risk operations

### Description

Single-key admin control over treasury rotation and token sweeps is a significant centralization risk. A two-step confirmation pattern—where a first signer proposes an action and a second signer confirms within a ledger window—reduces the blast radius of a compromised admin key. This item stubs the pattern for the highest-risk operations without blocking MVP delivery of lower-risk admin calls.

### Tasks

- Add `pending_admin_action: Option<AdminAction>` storage with proposer, action payload, and expiry ledger.
- Implement `propose_admin_action` and `confirm_admin_action` entrypoints; execute on confirmation.
- Expire pending actions after a configurable ledger window; emit `AdminActionExpired` if not confirmed.
- Add tests for confirmation, expiry, wrong confirmer, and cancellation.

### Additional Requirements

- Apply two-step pattern only to treasury rotation and sweep; simpler admin calls remain single-step.
- Document which operations require two-step in `SECURITY.md`.

### Acceptance Criteria

- High-risk operations cannot execute from a single signature in tests.
- Expired proposals are inert and cannot be replayed.
- Audit events are emitted at proposal, confirmation, and expiry.

---

## Contract — Claim amount cap per policy period: rolling cumulative limit

### Description

Without a rolling claim cap, a single policy could file multiple claims totalling far more than the coverage limit within a short window. This item tracks cumulative claims paid per policy within a configurable ledger window and reverts new claims that would exceed the cap. The cap is admin-configurable within absolute bounds and emits an event on change.

### Tasks

- Store `(policy_id, window_start, cumulative_claimed)` per policy; reset on window rollover.
- Check cumulative + new claim amount against cap at `file_claim`; revert if exceeded.
- Admin setter for cap with bounds validation and `ClaimCapUpdated` event.
- Add tests for single claim at cap, two claims summing to cap, and one claim over cap.

### Additional Requirements

- Window rollover must be deterministic based on ledger anchors, not wall clock.
- Document interaction with deductible: cap applies to gross or net amount per product spec.

### Acceptance Criteria

- Claims exceeding rolling cap revert with a clear error.
- Cap changes do not retroactively affect in-progress claims.
- Backend can display remaining claimable amount from indexed data.

---

## Contract — Event replay protection: per-holder nonce on state-mutating calls

### Description

Without replay protection, a signed transaction for `initiate_policy` or `file_claim` could theoretically be resubmitted if sequence number management has gaps. Adding an optional per-holder nonce checked and incremented on each call provides an additional layer of idempotency beyond Stellar's native sequence numbers, and makes the intent of each call explicit for audit trails.

### Tasks

- Add `holder_nonce: u64` map in storage; increment on each successful mutating call.
- Accept an optional `expected_nonce` parameter; revert if provided and mismatched.
- Document that this is supplementary to Stellar sequence numbers, not a replacement.
- Add tests for nonce mismatch revert and correct increment across multiple calls.

### Additional Requirements

- Nonce must not be required in MVP if it complicates UX; document as opt-in.
- Ensure nonce storage does not create unbounded growth for large holder sets.

### Acceptance Criteria

- Calls with mismatched nonces revert deterministically.
- Nonce increments are visible via a read entrypoint for frontend pre-flight checks.
- Tests cover sequential calls and gap attempts.

---

## Contract — Configurable voting deadline: per-claim ledger offset from filing

### Description

Hardcoded voting deadlines make it impossible to adjust governance responsiveness without redeployment. Storing `voting_duration_ledgers` in instance storage and computing each claim's deadline at filing time allows admin tuning while preserving immutability of existing claim deadlines. The frontend countdown and backend scheduler must read the same deadline field from indexed claim data.

### Tasks

- Store `voting_duration_ledgers: u32` in instance storage with admin setter and bounds.
- Set `deadline_ledger = file_ledger + voting_duration_ledgers` on each claim at filing.
- Finalization and late-vote checks use the stored per-claim deadline, not the current config.
- Add tests for deadline boundary votes and config changes not affecting existing claims.

### Additional Requirements

- Emit `VotingDurationUpdated` event with old and new values.
- Document minimum and maximum allowed durations with rationale.

### Acceptance Criteria

- Votes at deadline ledger succeed; votes one ledger after revert.
- Config changes only affect claims filed after the change.
- Frontend deadline display matches on-chain `deadline_ledger` field.

---

## Contract — Policy batch query: fetch multiple policies in one simulation call

### Description

Dashboards and indexer recovery tools often need to fetch several policies at once. A single simulation call for a bounded batch is more efficient than N sequential RPC calls and reduces latency for the Next.js policies dashboard on initial load. The entrypoint must enforce a hard cap on batch size to prevent resource exhaustion.

### Tasks

- Implement `get_policies_batch(ids: Vec<u64>) -> Vec<Option<Policy>>` capped at a documented max (e.g. 20).
- Return `None` for missing IDs without reverting.
- Add tests for full batch, partial hits, empty input, and over-cap input.
- Document the cap value and rationale in the entrypoint comment.

### Additional Requirements

- Do not introduce unbounded iteration; cap must be enforced before any storage reads.
- Align return type with the existing `get_policy` return shape for consistent frontend parsing.

### Acceptance Criteria

- Over-cap requests revert with a clear error.
- Mixed present/absent ID batches return correct `None` positions.
- Backend simulation service uses this entrypoint for bulk dashboard loads.

---

## Contract — Claim status history log: append-only transition records per claim

### Description

A single `status` field on a claim loses the history of how it got there. An append-only bounded log of `(status, ledger)` tuples per claim enables the Next.js timeline component to render the full lifecycle without relying solely on indexed events, which may have gaps during reindex operations. The log must be capped to prevent storage griefing.

### Tasks

- Add `status_history: Vec<(ClaimStatus, u32)>` to claim storage, capped at a documented max.
- Append on every status transition; drop oldest if cap exceeded (document this choice).
- Expose via `get_claim` return struct and a dedicated `get_claim_history(claim_id)` entrypoint.
- Add tests verifying append order and cap enforcement.

### Additional Requirements

- Cap must be large enough to cover the full expected lifecycle including appeals if implemented.
- Document that history may be incomplete if cap is exceeded.

### Acceptance Criteria

- Status history matches transition sequence in integration tests.
- Cap overflow is handled gracefully without reverting the underlying transition.
- Frontend timeline component can render history from this field alone.

---

## Contract — Admin-configurable quorum threshold: basis points in instance storage

### Description

A hardcoded quorum percentage cannot adapt to changing voter set sizes or governance maturity. Storing `quorum_bps` (basis points, 1–10000) in instance storage and reading it at finalization allows the protocol to tune governance sensitivity without redeployment. Changes must be authenticated, bounded, and emitted as events so the frontend governance docs stay accurate.

### Tasks

- Store `quorum_bps: u32` in instance storage; admin setter with range validation and event.
- Finalization reads `quorum_bps` and computes required votes from eligible voter count.
- Add tests for threshold boundary outcomes: exactly at quorum, one vote below, one above.
- Document the quorum formula (cast votes vs eligible voters) in code comments.

### Additional Requirements

- Emit `QuorumUpdated` event with old and new values.
- Changes to quorum must not retroactively affect claims already in `Processing`.

### Acceptance Criteria

- Finalization outcomes match expected results for boundary quorum inputs in tests.
- Non-admin callers cannot update quorum.
- Frontend governance docs reference the same formula as the contract.

---

## Contract — Payout beneficiary override: holder-designated alternate recipient

### Description

Some policyholders may want payouts sent to a cold wallet, multisig, or estate address rather than the signing key. Allowing a holder to designate a `beneficiary` address at policy creation or update time improves UX for sophisticated users without changing the authentication model—the holder still signs all mutating calls. Payout logic must use the beneficiary address, defaulting to the holder if unset.

### Tasks

- Add optional `beneficiary: Option<Address>` to `Policy`; settable at initiation and via a dedicated `set_beneficiary` entrypoint.
- Payout transfer targets `beneficiary.unwrap_or(holder)`.
- Emit `BeneficiaryUpdated` event on changes with old and new values.
- Add tests for unset default, explicit override, and unauthorized update attempts.

### Additional Requirements

- Beneficiary updates must be holder-authenticated; admin cannot override without holder consent.
- Document phishing risk: users should verify beneficiary addresses carefully.

### Acceptance Criteria

- Payouts reach the correct address in all test configurations.
- Unauthorized beneficiary changes revert.
- Frontend policy detail page displays beneficiary with a warning if it differs from the connected wallet.

---

## Contract — Contract version entrypoint: semver string readable via simulation

### Description

Support engineers and automated monitors need a reliable way to confirm which contract version is deployed without parsing wasm metadata externally. A `version()` read-only entrypoint returning the semver string stamped at build time via `env!("CARGO_PKG_VERSION")` provides this without any state mutation. The backend deployment registry can call this via simulation to verify version consistency after deploys.

### Tasks

- Implement `version() -> String` using `env!("CARGO_PKG_VERSION")` with no storage reads or writes.
- Add a test asserting the return value is non-empty and matches `Cargo.toml`.
- Document the entrypoint in the event dictionary and OpenAPI notes.
- Wire backend deployment registry to call this after each deploy and record the result.

### Additional Requirements

- Do not embed network or environment identifiers in the version string; keep it pure semver.
- Ensure the entrypoint is callable without authentication.

### Acceptance Criteria

- Simulation returns the correct semver string matching `Cargo.toml`.
- Backend deployment registry records version on deploy and alerts on mismatch.
- No state mutation occurs on the version call path.

---

## Contract — Claim withdrawal: holder cancels own claim before voting starts

### Description

A claimant may realize they filed in error or want to refile with better evidence. Allowing withdrawal before any votes are cast reduces governance noise and avoids wasting voter attention on invalid claims. Once voting begins, withdrawal must be blocked to prevent manipulation of in-progress governance rounds. Withdrawn claims must remain readable for audit purposes.

### Tasks

- Implement `withdraw_claim(claim_id)` authenticated by the claimant.
- Allow withdrawal only when `status == Processing` and `approvals + rejections == 0`.
- Set status to `Withdrawn`; emit `ClaimWithdrawn` event; restore rate-limit counter slots.
- Add tests for successful withdrawal, post-vote rejection, and unauthorized withdrawal.

### Additional Requirements

- Withdrawn claims must not be finalized or paid out.
- Document whether withdrawn claims count against the per-policy claim rate limit.

### Acceptance Criteria

- Withdrawal succeeds before any votes; reverts after first vote in tests.
- Rate-limit counters are correctly restored after withdrawal.
- Indexer can display `Withdrawn` status distinctly on the claims board.

---

## Contract — Treasury balance read entrypoint: protocol solvency visibility

### Description

The backend solvency dashboard and frontend admin panel need a trust-minimized way to check whether the protocol can cover outstanding approved claims. A `get_treasury_balance() -> i128` entrypoint reading the contract's own token balance via `token::Client::balance` provides this without requiring off-chain balance tracking. It must be callable without authentication and must not mutate state.

### Tasks

- Implement `get_treasury_balance() -> i128` using the configured premium token client.
- Return the raw minor-unit balance; document decimal interpretation in the entrypoint comment.
- Add a test using the Soroban token mock verifying correct balance reflection.
- Wire backend solvency job to call this via simulation on a scheduled interval.

### Additional Requirements

- If multi-asset is enabled, document which asset's balance is returned or implement per-asset variants.
- Do not expose internal accounting details beyond the raw balance.

### Acceptance Criteria

- Simulation returns the correct balance matching mock token state in tests.
- No state mutation occurs on the balance call path.
- Backend solvency alert fires when balance falls below a configurable threshold.

---

## Contract — Configurable max evidence count: admin-settable per-claim limit

### Description

The maximum number of evidence URLs per claim is currently a compile-time constant. Making it admin-configurable within absolute hard bounds allows the protocol to respond to storage cost changes or product requirements without redeployment. Existing claims must not be retroactively affected by limit changes.

### Tasks

- Store `max_evidence_count: u32` in instance storage; admin setter with absolute hard max and event.
- `file_claim` reads the current config value for validation.
- Add tests for filing at limit, over limit, and after admin reduces the limit.
- Document that limit reductions do not invalidate existing claims.

### Additional Requirements

- Absolute hard max must be enforced in the setter to prevent griefing via large limits.
- Emit `MaxEvidenceCountUpdated` event with old and new values.

### Acceptance Criteria

- Claims with evidence count exceeding current config revert.
- Admin updates are authenticated and logged.
- Existing claims with evidence counts above a newly reduced limit remain valid.

---

## Contract — Policy expiry event: on-chain signal for renewal reminder pipeline

### Description

The backend notification service needs a reliable on-chain signal to trigger renewal reminders. Emitting a `PolicyExpired` event when expiry is detected—either via a keeper call or during a related operation—gives the indexer a clean hook without requiring it to poll every policy's expiry ledger. The event must include enough data for the notification service to identify the holder and policy without additional lookups.

### Tasks

- Emit `PolicyExpired` with `policy_id`, holder, and expiry ledger when expiry is detected.
- Trigger emission from `process_expired` keeper entrypoint and from `renew_policy` when called on an already-expired policy.
- Add tests verifying event emission at and after expiry ledger.
- Document that the event may be emitted with a delay relative to the actual expiry ledger.

### Additional Requirements

- Do not emit duplicate expiry events for the same policy.
- Backend notification service must deduplicate on `policy_id` to handle delayed keeper calls.

### Acceptance Criteria

- `PolicyExpired` event is emitted exactly once per expiry in tests.
- Event payload is sufficient for the notification service without additional RPC calls.
- Keeper entrypoint reverts if policy is not yet expired.

---

## Contract — Keeper entrypoint: permissionless expiry and deadline processing

### Description

Relying on admin to trigger expiry and deadline transitions creates a liveness dependency on a privileged key. Permissionless keeper entrypoints allow any actor—automated bots, backend workers, or community members—to advance state when conditions are met, improving protocol liveness and decentralization. Each entrypoint must be idempotent and revert if no action is needed.

### Tasks

- Implement `process_expired(policy_id)`: marks policy inactive and emits `PolicyExpired` if past expiry and not already inactive.
- Implement `process_deadline(claim_id)`: triggers finalization if voting deadline has passed and claim is still `Processing`.
- Both entrypoints require no authentication; revert with clear errors if conditions are not met.
- Add tests for correct execution, premature calls, and already-processed states.

### Additional Requirements

- Keeper calls must not be exploitable to skip governance steps or manipulate outcomes.
- Document expected keeper bot cadence and incentive model (if any) in the runbook.

### Acceptance Criteria

- Keeper calls succeed exactly when conditions are met; revert otherwise.
- Repeated keeper calls on already-processed states are safe no-ops or clear reverts.
- Backend worker can use these entrypoints as the primary mechanism for deadline enforcement.

---

## Backend — Soroban event subscription: SSE stream for real-time claim updates

### Description

Polling the indexer for claim status changes adds latency and unnecessary load. A Server-Sent Events endpoint that pushes indexed claim updates to connected frontend clients reduces polling frequency and improves the perceived responsiveness of the claims board and vote interface. The stream must authenticate subscribers, respect rate limits, and close gracefully on disconnect.

### Tasks

- Implement `GET /events/claims` SSE endpoint using NestJS `@Sse` decorator.
- Emit events when the indexer worker upserts claim rows; use Redis pub/sub or BullMQ events as the internal bus.
- Authenticate via wallet JWT or allow anonymous with stricter rate limits.
- Add reconnect guidance in response headers (`retry` field).
- Document max concurrent connections and backpressure behavior.

### Additional Requirements

- SSE connections must not hold DB transactions open.
- Graceful shutdown must drain active SSE connections without data loss.

### Acceptance Criteria

- Frontend receives a push event within configured max latency after a claim status change in staging.
- Disconnected clients reconnect and receive missed events via cursor if implemented, or fall back to polling.
- Load test confirms connection count stays within documented limits.

---

## Backend — Soroban simulation cache: short-TTL Redis layer for quote responses

### Description

Quote simulations hit the Soroban RPC on every request, adding latency and consuming rate-limit budget. A short-TTL Redis cache keyed by a hash of normalized input parameters reduces redundant RPC calls for identical quote requests within a configurable window. The cache must be invalidated or bypassed when admin updates multiplier tables, and must never serve stale quotes beyond the documented TTL.

### Tasks

- Implement cache key as SHA-256 of sorted, normalized quote input DTO.
- Store serialized simulation result in Redis with configurable TTL (default: 30s).
- Bypass cache when `Cache-Control: no-cache` header is present.
- Emit a cache-hit metric counter for observability.
- Add integration tests verifying cache hit, miss, and TTL expiry behavior.

### Additional Requirements

- Document TTL tradeoffs: too long risks stale pricing; too short wastes RPC budget.
- Cache must not store error responses to avoid propagating transient failures.

### Acceptance Criteria

- Repeated identical quote requests within TTL return cached results without RPC calls.
- Cache is bypassed correctly on `no-cache` requests.
- Metrics distinguish cache hits from misses in staging dashboards.

---

## Backend — Horizon proxy: filtered transaction history without exposing API keys

### Description

The frontend transaction history page needs access to Horizon data scoped to a wallet address. Proxying through the backend keeps Horizon API keys server-side, allows response filtering to remove irrelevant operations, and enables rate limiting per wallet. The proxy must not cache sensitive data beyond short TTLs and must forward only fields needed by the frontend.

### Tasks

- Implement `GET /horizon/transactions?account=<address>` proxying to configured Horizon URL.
- Filter response to relevant operation types; strip internal Horizon fields not needed by UI.
- Apply per-wallet rate limiting; return `429` with `Retry-After` on excess.
- Add integration tests with a mocked Horizon response.
- Document which Horizon fields are forwarded and why others are stripped.

### Additional Requirements

- Never expose Horizon API keys in response headers or error bodies.
- Document Horizon finality lag and how the frontend should communicate it to users.

### Acceptance Criteria

- Frontend receives filtered transaction data without direct Horizon access.
- Rate limits prevent abuse without blocking normal usage patterns.
- Mocked integration tests pass in CI without real Horizon credentials.

---

## Backend — Claim aggregation service: quorum progress and deadline computation

### Description

The claims board needs pre-computed quorum progress percentages and human-readable deadline estimates without requiring the frontend to implement the governance math. A dedicated service layer computes these from indexed vote counts, eligible voter totals, and deadline ledgers, returning structured fields the frontend can render directly. This centralizes the governance formula in one place aligned with the contract.

### Tasks

- Implement `ClaimAggregationService` computing `quorum_progress_pct`, `votes_needed`, and `deadline_estimate_utc` from DB rows.
- Use the same quorum formula as the contract; document the source of eligible voter count.
- Cache aggregated results in Redis with short TTL; invalidate on new vote rows.
- Add unit tests with fixed vote/voter fixtures verifying formula correctness.
- Expose aggregated fields on `GET /claims/:id` response DTO.

### Additional Requirements

- Document that `deadline_estimate_utc` is approximate due to variable ledger close times.
- Align formula with the contract's `quorum_bps` configuration read from the deployment registry.

### Acceptance Criteria

- Aggregated fields match manual calculations for test fixtures.
- Frontend can render quorum progress bar without additional math.
- Formula changes require intentional test vector updates.

---

## Backend — Policy renewal reminder job: scheduled notifications before expiry

### Description

Policyholders who miss renewal windows lose coverage silently. A scheduled job scanning for policies expiring within a configurable ledger window and enqueuing notification jobs reduces churn and improves user trust. The job must be idempotent—running it twice must not send duplicate reminders—and must respect user notification preferences.

### Tasks

- Implement a BullMQ repeatable job scanning `policies` table for upcoming expiries.
- Enqueue one notification job per policy per reminder window; deduplicate on `(policy_id, reminder_type)`.
- Respect `notification_preferences` table opt-in flags.
- Add integration tests with fixed expiry fixtures verifying correct enqueue behavior.
- Document configurable lead time (e.g. 7 days, 1 day before expiry in ledger terms).

### Additional Requirements

- Job must not scan unbounded rows; use indexed queries with pagination.
- Log skipped policies (opted out, already notified) for ops visibility.

### Acceptance Criteria

- Reminder jobs are enqueued exactly once per policy per window in tests.
- Opted-out policies receive no notifications.
- Job completes within documented time budget on staging dataset sizes.

---

## Backend — Staff audit log API: paginated read with filter and export

### Description

The admin dashboard needs a paginated, filterable view of the `admin_audit_log` table for compliance reviews and incident investigations. Filters should include actor, action type, and date range. An optional CSV export endpoint supports offline analysis. All access must be role-gated and logged as a meta-audit entry.

### Tasks

- Implement `GET /admin/audits` with filters, cursor pagination, and role guard.
- Add `GET /admin/audits/export` returning CSV with streaming to avoid memory exhaustion on large datasets.
- Log each audit log access as a meta-entry with actor and query parameters.
- Add tests for filter combinations, pagination, and unauthorized access.
- Document retention policy for audit log rows.

### Additional Requirements

- CSV export must not include PII beyond what is already in the audit log schema.
- Streaming export must handle large result sets without timeout.

### Acceptance Criteria

- Filters return correct subsets in tests with fixed fixtures.
- Unauthorized callers receive `403` consistently.
- CSV export matches paginated JSON results for the same filter parameters.

---

## Backend — Solvency monitoring job: treasury balance alerts and dashboard feed

### Description

The protocol must not approve claims it cannot pay. A scheduled solvency monitoring job calls the `get_treasury_balance` contract entrypoint via simulation, compares the result against the sum of outstanding approved-but-unpaid claims, and emits alerts when the buffer falls below a configurable threshold. Results feed the admin dashboard solvency widget.

### Tasks

- Implement a scheduled job calling `get_treasury_balance` via `SorobanRpcService`.
- Query DB for sum of `Approved` claim amounts not yet in `Paid` status.
- Emit a structured alert (log + optional webhook) when `balance - outstanding < threshold`.
- Store latest solvency snapshot in Redis for dashboard reads.
- Add unit tests with mocked RPC and DB fixtures.

### Additional Requirements

- Job must handle RPC failures gracefully without false-positive alerts.
- Threshold must be configurable per environment without redeployment.

### Acceptance Criteria

- Alert fires in staging when mocked balance drops below threshold.
- Dashboard widget reads latest snapshot without triggering a live RPC call.
- RPC failures produce a distinct "solvency unknown" state rather than a false alert.

---

## Backend — OpenAPI client codegen: TypeScript types for frontend consumption

### Description

Manually maintaining TypeScript types in the frontend that mirror backend DTOs creates drift and bugs. Generating a typed client from the OpenAPI spec at build time ensures the frontend always uses the correct request/response shapes. The generation step must run in CI and fail if the spec is out of date relative to the controllers.

### Tasks

- Add `openapi-typescript` or `orval` to the backend build pipeline generating a spec file.
- Add a CI step in the frontend workflow fetching or copying the spec and running codegen.
- Document the workflow for updating types after backend DTO changes.
- Add a CI check that fails if the committed spec diverges from the generated one.
- Provide a `make generate-client` or equivalent command for local use.

### Additional Requirements

- Generated files must not be manually edited; add a header comment warning.
- Codegen must handle nullable fields and discriminated unions correctly.

### Acceptance Criteria

- Frontend TypeScript compiles against generated types without manual overrides.
- CI fails when backend DTOs change without a corresponding spec update.
- New engineers can regenerate types with a single documented command.

---

## Backend — Claim evidence URL sanitization: gateway allowlist and SSRF prevention

### Description

Evidence URLs stored on-chain and returned by the claims API could point to internal network addresses if not validated, enabling SSRF attacks via the backend's IPFS fetch or preview endpoints. All evidence URLs must be validated against a gateway allowlist before being returned to clients or fetched server-side. Invalid URLs must be replaced with a safe placeholder in API responses.

### Tasks

- Define `ALLOWED_IPFS_GATEWAYS` config list; validate evidence URLs against it on ingest and on API response.
- Strip or replace non-allowlisted URLs in `GET /claims/:id` response with a documented placeholder.
- Add SSRF prevention for any server-side URL fetch (no private IP ranges, no `file://`).
- Add tests for allowlisted, non-allowlisted, and malformed URLs.
- Document the allowlist update process for adding new gateway providers.

### Additional Requirements

- Allowlist must be configurable per environment without code changes.
- Log sanitization events for security monitoring without storing the original malicious URL in logs.

### Acceptance Criteria

- Non-allowlisted URLs never reach clients or internal fetch calls in tests.
- SSRF attempts via crafted evidence URLs are blocked at the validation layer.
- Allowlist changes take effect without service restart.

---

## Backend — Database connection pool tuning: documented limits and health checks

### Description

Default ORM connection pool settings are rarely optimal for production workloads. Underconfigured pools cause request queuing under load; overconfigured pools exhaust database connection limits. This item documents the chosen pool size, idle timeout, and connection lifetime settings with rationale, adds a health check that verifies pool availability, and provides a runbook for tuning under observed load.

### Tasks

- Configure TypeORM/Prisma pool with explicit `max`, `min`, `idleTimeoutMillis`, and `connectionTimeoutMillis`.
- Add pool metrics to the `/metrics` endpoint (active, idle, waiting counts).
- Update `/health` to include a DB connectivity check with a short timeout.
- Document pool sizing rationale relative to expected concurrency and DB instance limits.
- Add a runbook section for diagnosing pool exhaustion from metrics.

### Additional Requirements

- Pool settings must be configurable via environment variables for different deployment sizes.
- Health check must not hold a connection open longer than necessary.

### Acceptance Criteria

- Pool metrics are visible in staging Prometheus scrape.
- `/health` returns `503` within documented timeout when DB is unreachable.
- Load test results inform documented pool size recommendations.

---

## Backend — Structured error catalog: stable codes, HTTP status mapping, and i18n keys

### Description

Inconsistent error responses force frontend engineers to write fragile string-matching logic. A centralized error catalog mapping stable `code` strings to HTTP status codes and i18n message keys ensures every error the API emits is documented, testable, and translatable. The catalog must be checked into the repo and referenced by both the global exception filter and OpenAPI extensions.

### Tasks

- Define `ErrorCatalog` as a typed constant map: `code -> { httpStatus, i18nKey, description }`.
- Update the global exception filter to use catalog entries for all known error types.
- Export the catalog as a JSON file consumed by the frontend i18n message files.
- Add a CI check that every `throw new AppException(code)` references a catalog entry.
- Document the process for adding new error codes with required review steps.

### Additional Requirements

- Codes must be stable across releases; deprecate rather than rename existing codes.
- HTTP status must be semantically correct per RFC 7231.

### Acceptance Criteria

- All API errors in tests use catalog codes; no raw string messages in exception throws.
- Frontend i18n file is generated from the catalog without manual duplication.
- Unknown error codes fail CI lint check.

---

## Backend — Ledger cursor persistence: resumable indexer with gap detection

### Description

If the indexer worker restarts, it must resume from the last successfully processed ledger rather than reprocessing from genesis or missing ledgers. A persistent `ledger_cursor` table with atomic updates and gap detection ensures no events are skipped during restarts or RPC outages. The admin reindex endpoint must be able to reset the cursor to an arbitrary ledger.

### Tasks

- Implement `ledger_cursors` table with `network`, `last_processed_ledger`, and `updated_at` columns.
- Update cursor atomically within the same DB transaction as event upserts.
- Add gap detection: alert if `current_ledger - last_processed > threshold`.
- Admin `POST /admin/reindex` resets cursor and enqueues a reindex job.
- Add tests for cursor advancement, gap detection trigger, and reset behavior.

### Additional Requirements

- Cursor must be per-network to support multi-network deployments.
- Gap alerts must deduplicate to avoid alert storms during extended RPC outages.

### Acceptance Criteria

- Worker resumes from correct ledger after restart in integration tests.
- Gap detection fires in staging when a simulated RPC outage creates a ledger gap.
- Reindex reset is admin-authenticated and audit-logged.

---

## Backend — Vote ingestion and tally reconciliation: consistency checks on indexer writes

### Description

Vote events from the contract must be ingested idempotently and the indexed tally must always reconcile with the count of individual vote rows. A reconciliation job or post-ingest assertion catches bugs where tally updates and vote row inserts diverge due to partial failures. Discrepancies must trigger alerts and block finalization display until resolved.

### Tasks

- Ingest `VoteLogged` events into `votes` table with unique constraint on `(claim_id, voter_address)`.
- Update `claims.approvals` and `claims.rejections` within the same DB transaction as vote insert.
- Implement a scheduled reconciliation job comparing tally columns against `COUNT` of vote rows.
- Alert on discrepancies; expose reconciliation status on `GET /claims/:id`.
- Add tests for duplicate vote ingestion and tally consistency.

### Additional Requirements

- Reconciliation job must be safe to run concurrently with live ingestion.
- Document the expected consistency window between event ingestion and tally update.

### Acceptance Criteria

- Duplicate vote events do not create duplicate rows or double-count tallies.
- Reconciliation job detects injected discrepancies in staging tests.
- Claims board displays a data-quality warning when reconciliation fails.

---

## Backend — Multi-network support: environment-scoped RPC and contract configuration

### Description

Operating on Futurenet, Testnet, and Mainnet simultaneously requires strict environment isolation. A single misconfigured RPC URL or contract ID pointing at the wrong network can cause silent data corruption or financial loss. This item formalizes network configuration as a first-class concern with validation, per-network deployment registry reads, and runtime assertions.

### Tasks

- Define a `NetworkConfig` type with `rpcUrl`, `horizonUrl`, `networkPassphrase`, and `contractIds` fields.
- Load and validate network config at startup; fail fast on missing or inconsistent values.
- Scope all RPC calls and DB queries to the active network; prevent cross-network data mixing.
- Add a startup assertion comparing the RPC network passphrase against the configured value.
- Document the environment variable naming convention for multi-network deployments.

### Additional Requirements

- Never allow Mainnet contract IDs to be used with Testnet RPC or vice versa.
- Log the active network prominently at startup for ops visibility.

### Acceptance Criteria

- Startup fails with a clear error when network config is inconsistent.
- RPC calls use the correct passphrase for the configured network in integration tests.
- Ops can identify the active network from startup logs without reading config files.

---

## Backend — Job queue observability: BullMQ dashboard and dead-letter monitoring

### Description

Failed jobs that silently accumulate in dead-letter queues cause data gaps that are hard to diagnose. Exposing a BullMQ dashboard (Bull Board or equivalent) for staff, adding dead-letter queue monitoring with alerts, and documenting retry and manual replay procedures ensures the indexer and notification pipelines remain healthy and recoverable.

### Tasks

- Integrate Bull Board behind staff authentication at `/admin/queues`.
- Configure dead-letter queues for indexer and notification workers with documented max retry counts.
- Add a metric counter for dead-letter queue depth; alert when above threshold.
- Document manual job replay procedure for ops.
- Add integration tests verifying failed jobs land in dead-letter queue after max retries.

### Additional Requirements

- Bull Board must not be accessible without staff authentication.
- Dead-letter alerts must include job type and failure reason for triage.

### Acceptance Criteria

- Staff can view queue depths and failed jobs via the dashboard in staging.
- Dead-letter alert fires in staging when a job is injected to fail repeatedly.
- Manual replay procedure is documented and tested by at least one engineer.

---

## Backend — Request tracing: OpenTelemetry spans for RPC and DB calls

### Description

Distributed tracing across NestJS, Soroban RPC, and PostgreSQL calls enables precise latency attribution during incidents. Adding OpenTelemetry instrumentation with automatic spans for HTTP, DB, and Redis operations, and propagating trace context via `traceparent` headers, allows the team to identify bottlenecks without guesswork. Traces must be exportable to a configurable OTLP endpoint.

### Tasks

- Add `@opentelemetry/sdk-node` with auto-instrumentation for HTTP, Prisma/TypeORM, and Redis.
- Configure OTLP exporter via environment variable; default to no-op in development.
- Propagate `x-request-id` as a span attribute for correlation with structured logs.
- Add a custom span around Soroban RPC simulation calls with contract ID and method attributes.
- Document local Jaeger setup for development tracing.

### Additional Requirements

- Sampling rate must be configurable to avoid overwhelming the OTLP backend in production.
- Sensitive parameters (XDR, private keys) must never appear as span attributes.

### Acceptance Criteria

- A single quote request produces a trace with spans for HTTP, RPC simulation, and cache check in staging.
- Trace IDs correlate with structured log `requestId` fields.
- Production sampling rate is documented and configurable without redeployment.

---

## Backend — Contract event version migration: parser registry with semver routing

### Description

When contract event schemas change between versions, the indexer must parse old and new events correctly without a full reindex. A parser registry mapping contract semver ranges to parser implementations allows the indexer to handle mixed-version event streams during rolling upgrades and historical reindexes.

### Tasks

- Define a `ParserRegistry` mapping `(contractId, semver range) -> EventParser`.
- Implement parsers for the initial event schema; add a migration parser stub for the next version.
- Route incoming events to the correct parser based on the deployment registry version at the event's ledger.
- Add tests with mixed-version event fixtures verifying correct parser selection.
- Document the process for adding a new parser version alongside a contract release.

### Additional Requirements

- Parser selection must be deterministic for a given ledger and contract version.
- Unknown event schemas must produce a structured warning row, not a silent skip.

### Acceptance Criteria

- Mixed-version event streams parse correctly in integration tests.
- Unknown schemas produce observable warnings in logs and metrics.
- New parser versions can be added without modifying existing parser code.

---

## Backend — Wallet address normalization: consistent storage and comparison format

### Description

Stellar addresses can appear in different formats (G-address, C-address for contracts, muxed accounts) depending on the SDK version and context. Inconsistent storage formats cause lookup failures, duplicate rows, and security gaps where the same address appears as two distinct identities. All wallet addresses must be normalized to a canonical format before storage and comparison.

### Tasks

- Implement a `normalizeAddress(raw: string): string` utility validating and canonicalizing Stellar addresses.
- Apply normalization at all ingestion points: event parser, API request DTOs, and auth middleware.
- Add a DB migration normalizing any existing non-canonical address rows.
- Add tests for G-addresses, muxed addresses, and invalid inputs.
- Document the chosen canonical format and rationale.

### Additional Requirements

- Muxed account IDs must be handled per product decision: strip mux ID or reject.
- Invalid addresses must fail validation at the API boundary, not silently store garbage.

### Acceptance Criteria

- The same Stellar address in different formats resolves to the same DB row.
- Invalid addresses are rejected at API boundaries with clear errors.
- Existing data migration runs cleanly in CI against the seed database.

---

## Backend — Configurable indexer batch size: tunable ledger fetch window

### Description

A fixed ledger fetch window in the indexer may be too large during catch-up (causing timeouts) or too small during normal operation (causing excessive RPC calls). Making the batch size configurable via environment variable with documented defaults and limits allows operators to tune performance without code changes.

### Tasks

- Extract `INDEXER_BATCH_SIZE` env var with validation (min: 1, max: 100, default: 10).
- Apply batch size to the ledger fetch loop; document impact on RPC rate limit consumption.
- Add a metric for average batch processing time to inform tuning decisions.
- Update the indexer runbook with batch size tuning guidance.
- Add tests verifying batch size boundaries are respected.

### Additional Requirements

- Batch size changes must take effect on the next job cycle without restart where possible.
- Document the relationship between batch size and indexer lag metrics.

### Acceptance Criteria

- Indexer respects configured batch size in integration tests.
- Batch processing time metric is visible in staging Prometheus scrape.
- Runbook includes a decision tree for batch size tuning based on observed metrics.

---

## Backend — Soft delete and data retention: policy and claim row lifecycle management

### Description

Hard-deleting policy or claim rows breaks audit trails and indexer reindex consistency. Implementing soft deletes with `deleted_at` timestamps and a configurable retention policy ensures data is logically removed from API responses while remaining available for compliance queries and reindex operations. A scheduled cleanup job permanently removes rows beyond the retention window.

### Tasks

- Add `deleted_at` columns to `policies`, `claims`, and `votes` tables; update queries to filter soft-deleted rows.
- Implement `DELETE /admin/policies/:id` setting `deleted_at` rather than hard-deleting.
- Add a scheduled cleanup job permanently removing rows older than `DATA_RETENTION_DAYS`.
- Add tests verifying soft-deleted rows are excluded from API responses but visible in admin queries.
- Document retention policy and legal basis in the privacy runbook.

### Additional Requirements

- Cleanup job must be idempotent and safe to run concurrently with live ingestion.
- Soft-deleted rows must remain in `raw_events` table for reindex consistency.

### Acceptance Criteria

- Soft-deleted policies do not appear in public API responses.
- Cleanup job removes only rows beyond the retention window in tests.
- Admin queries can retrieve soft-deleted rows with an explicit `include_deleted` parameter.

---

## Frontend — Wallet session persistence: reconnect on page reload without re-prompting

### Description

Users who reload the page should not be forced to reconnect their wallet from scratch on every visit. Persisting the last-used wallet type and public key in `localStorage` and attempting a silent reconnect on mount improves UX significantly. The reconnect must fail gracefully if the extension is unavailable or the account has changed, without blocking the page render.

### Tasks

- Store `{ walletType, publicKey }` in `localStorage` on successful connect; clear on disconnect.
- Attempt silent reconnect on app mount; show a non-blocking banner if it fails.
- Validate that the reconnected public key matches the stored value; clear storage if mismatched.
- Add unit tests with mocked wallet adapter for success, failure, and mismatch cases.
- Document the security implications of storing public keys in `localStorage`.

### Additional Requirements

- Never store seed phrases, private keys, or signed transactions in `localStorage`.
- Reconnect attempt must not delay initial page render; run after hydration.

### Acceptance Criteria

- Users with a previously connected wallet see their address on reload without a prompt.
- Extension unavailability shows a helpful banner without breaking the page.
- Mismatched keys clear storage and prompt a fresh connect.

---

## Frontend — Network mismatch banner: blocking overlay when wallet and app networks diverge

### Description

A user connected to Testnet trying to sign a Mainnet transaction will get a confusing wallet error. A prominent blocking overlay detecting the mismatch before any transaction is attempted prevents wasted signing attempts and user frustration. The banner must explain the mismatch clearly and provide a one-click path to switch networks in the app settings.

### Tasks

- Compare wallet-reported network passphrase against the app's configured network on every wallet event.
- Render a full-screen blocking overlay with clear copy and a "Switch Network" button on mismatch.
- Dismiss overlay automatically when the mismatch is resolved.
- Add unit tests for mismatch detection and overlay render/dismiss lifecycle.
- Document the passphrase comparison logic and known edge cases (e.g. custom RPC).

### Additional Requirements

- Overlay must be keyboard accessible and screen-reader announced.
- Do not block read-only pages (landing, docs) that do not require wallet interaction.

### Acceptance Criteria

- Overlay appears immediately on network mismatch in manual testing.
- Overlay dismisses automatically when the correct network is selected.
- Screen readers announce the mismatch without requiring visual inspection.

---

## Frontend — Token amount formatting: locale-aware display with correct decimals

### Description

Displaying raw minor-unit token amounts (e.g. `1000000` for `1.00 USDC`) without formatting is a critical UX failure in a financial application. A shared formatting utility reading token decimal metadata from the backend manifest must be used consistently across all amount displays. The utility must handle edge cases: zero amounts, very large amounts, and amounts with trailing zeros.

### Tasks

- Implement `formatTokenAmount(raw: bigint, decimals: number, locale: string): string` utility.
- Apply to all premium, coverage, and payout amount displays across policy, claim, and history components.
- Read decimal metadata from the network manifest hook; never hardcode decimals.
- Add unit tests for zero, max safe integer, and locale-specific formatting.
- Document the utility in the component library README.

### Additional Requirements

- Never use JavaScript `number` type for token amounts; use `bigint` or string throughout.
- Locale formatting must not alter the underlying value, only the display string.

### Acceptance Criteria

- All amount displays in the app use the shared utility with no hardcoded decimal assumptions.
- Unit tests cover edge cases including zero and maximum expected values.
- Locale switching changes the display format without changing the underlying amount.

---

## Frontend — Optimistic UI updates: immediate feedback before indexer confirmation

### Description

Waiting for the indexer to confirm a transaction before updating the UI creates a frustrating delay. Optimistic updates—immediately reflecting the expected state change in the UI while polling for confirmation—improve perceived responsiveness. Rollback logic must handle cases where the transaction fails or the indexer returns an unexpected state.

### Tasks

- Implement optimistic update helpers for policy initiation, claim filing, and vote submission.
- Show a "pending" badge on affected rows immediately after transaction submission.
- Poll the backend with exponential backoff until the indexer confirms or a timeout is reached.
- Roll back optimistic state and show an error if confirmation fails within the timeout.
- Add unit tests for optimistic apply, confirmation, and rollback paths.

### Additional Requirements

- Optimistic state must not persist across page reloads; always rehydrate from the server.
- Document the maximum expected confirmation delay for each operation type.

### Acceptance Criteria

- Policy and claim rows show "pending" immediately after submission without waiting for indexer.
- Rollback restores the previous state cleanly when confirmation fails.
- Timeout and rollback behavior is documented in the UX copy.

---

## Frontend — React Query configuration: stale times, retry policy, and background refetch

### Description

Default React Query settings (zero stale time, aggressive retries) are poorly suited to a blockchain-backed application where data changes infrequently and RPC errors are transient. Configuring appropriate stale times per query type, bounded retry counts with backoff, and background refetch intervals reduces unnecessary load and improves UX consistency.

### Tasks

- Define a `queryClientConfig` with per-query-type stale times (e.g. policies: 30s, claims: 10s, votes: 5s).
- Set `retry: 3` with exponential backoff; disable retry for `4xx` errors.
- Enable `refetchOnWindowFocus` only for time-sensitive queries (active votes).
- Add a `useNetworkAwareQuery` hook pausing background refetch when offline.
- Document the configuration rationale in the frontend README.

### Additional Requirements

- Stale time configuration must be centralized; no per-component overrides without justification.
- Background refetch must respect the Page Visibility API to avoid battery drain on mobile.

### Acceptance Criteria

- Network tab in dev tools shows reduced redundant requests compared to default config.
- Offline state pauses background refetch without breaking the UI.
- Configuration is documented and reviewable in a single file.

---

## Frontend — Skeleton loading states: consistent placeholders across all data-fetching components

### Description

Blank white areas during data loading are jarring and make the app feel broken. Consistent skeleton loading states matching the shape of the loaded content reduce perceived load time and communicate that data is on its way. All list and detail components must use shared skeleton primitives rather than ad-hoc spinners.

### Tasks

- Build `SkeletonRow`, `SkeletonCard`, and `SkeletonDetail` primitives in the design system.
- Apply skeletons to policy list, claim list, claim detail, and vote tally components.
- Ensure skeletons respect `prefers-reduced-motion` by disabling shimmer animation.
- Add Storybook stories (or inline docs) for each skeleton variant.
- Audit existing components for spinner-only loading states and replace.

### Additional Requirements

- Skeleton dimensions must match the loaded content to avoid layout shift (CLS impact).
- Do not show skeletons for cached data that loads instantly.

### Acceptance Criteria

- No blank white areas during initial load on the policies and claims pages.
- CLS score is not negatively impacted by skeleton-to-content transitions.
- Reduced-motion users see static placeholders instead of animated shimmer.

---

## Frontend — Deep link routing: shareable URLs for policy and claim detail pages

### Description

Users sharing a claim or policy link must land on the correct detail page without being redirected to the dashboard. App Router dynamic routes for `/policies/[id]` and `/claims/[id]` must handle server-side rendering or static generation appropriately, return proper 404 pages for unknown IDs, and include correct OpenGraph metadata for social sharing previews.

### Tasks

- Implement `app/policies/[id]/page.tsx` and `app/claims/[id]/page.tsx` with data fetching.
- Add `generateMetadata` returning title and description from fetched data.
- Return a custom 404 component for unknown IDs using Next.js `notFound()`.
- Add canonical URL tags to prevent duplicate content issues.
- Test deep link navigation from the claims board and external URLs.

### Additional Requirements

- Server-rendered pages must not expose wallet-specific data in the initial HTML.
- OpenGraph images must not include wallet addresses or sensitive claim details.

### Acceptance Criteria

- Shared claim URLs render correct content without requiring wallet connection.
- Unknown IDs show a helpful 404 page with navigation back to the board.
- OpenGraph preview shows claim status and policy type without PII.

---

## Frontend — Form auto-save: draft persistence for multi-step claim wizard

### Description

A multi-step claim filing wizard that loses progress on accidental navigation is a significant UX failure. Persisting form drafts to `localStorage` with a TTL allows users to resume interrupted filings without re-entering data. Drafts must be cleared on successful submission and must not persist sensitive evidence file references beyond the session.

### Tasks

- Implement `useDraftPersistence(formKey, schema)` hook saving form state to `localStorage` on change.
- Set a 24-hour TTL on drafts; clear on successful claim submission.
- Show a "Resume draft" banner when a valid draft is detected on wizard mount.
- Never persist file objects or IPFS URLs in drafts; only persist text fields.
- Add unit tests for save, restore, expiry, and clear on submit.

### Additional Requirements

- Draft schema must be versioned; clear drafts with mismatched schema versions.
- Document that drafts are device-local and not synced across sessions.

### Acceptance Criteria

- Users can resume a partially completed claim wizard after closing and reopening the tab.
- Successful submission clears the draft without user action.
- File upload progress is not persisted; users must re-upload files on resume.

---

## Frontend — Countdown timer component: ledger-to-time estimation with caveats

### Description

Voting deadlines and renewal windows are expressed in ledger numbers on-chain. Converting these to human-readable countdowns requires an estimated ledger close time that is inherently approximate. A shared `LedgerCountdown` component must display the estimate with appropriate uncertainty copy, update in real time, and link to the backend documentation explaining the approximation.

### Tasks

- Implement `LedgerCountdown({ targetLedger, currentLedger, avgCloseSeconds })` component.
- Display days/hours/minutes with a "~" prefix indicating approximation.
- Update every 30 seconds using `setInterval` with cleanup on unmount.
- Show "Deadline passed" state when `currentLedger >= targetLedger`.
- Add unit tests for display formatting and deadline-passed state.

### Additional Requirements

- `avgCloseSeconds` must come from the network manifest, not be hardcoded.
- Component must not cause hydration mismatches; use client-only rendering for the live countdown.

### Acceptance Criteria

- Countdown displays correctly for future and past deadlines in unit tests.
- "~" prefix and approximation copy are present on all countdown displays.
- Component cleans up its interval on unmount without memory leaks.

---

## Frontend — Wallet address display: truncation, copy, and explorer link component

### Description

Stellar addresses are long and visually noisy. A shared `WalletAddress` component that truncates to `GXXXX...XXXX` format, provides a one-click copy button with confirmation feedback, and links to the correct network's Stellar Expert explorer is needed across policy, claim, and vote displays. The component must handle both G-addresses and C-addresses (contract IDs).

### Tasks

- Implement `WalletAddress({ address, network, showCopy, showExplorer })` component.
- Truncate to first 4 and last 4 characters with ellipsis; show full address in a tooltip.
- Copy button uses `navigator.clipboard` with a "Copied!" toast confirmation.
- Explorer link uses the correct Stellar Expert URL for the configured network.
- Add unit tests for truncation, copy feedback, and explorer URL generation.

### Additional Requirements

- Full address must be accessible to screen readers via `aria-label` even when truncated visually.
- Component must handle invalid addresses gracefully without throwing.

### Acceptance Criteria

- Address displays correctly truncated across all policy, claim, and vote pages.
- Copy button works in supported browsers and shows confirmation feedback.
- Explorer links point to the correct network in all environment configurations.

---

## Frontend — Empty state illustrations: contextual guidance for first-time users

### Description

First-time users landing on an empty policies dashboard or claims board need guidance on what to do next, not a blank table. Contextual empty state components with brief copy and a primary CTA (e.g. "Get your first quote") reduce bounce rates and guide users through the funnel. Illustrations must be SVG for performance and must respect reduced-motion preferences.

### Tasks

- Design and implement empty state components for policies list, claims board, and transaction history.
- Include a headline, one-sentence description, and a primary CTA button per empty state.
- Use inline SVG illustrations; add `aria-hidden` to decorative elements.
- Respect `prefers-reduced-motion` for any animated illustrations.
- Add Storybook stories or inline docs for each empty state variant.

### Additional Requirements

- Copy must be reviewed by product for tone and accuracy before launch.
- Empty states must not appear while data is still loading (use skeletons instead).

### Acceptance Criteria

- Empty states render correctly when API returns zero results in tests.
- CTAs navigate to the correct next step in the user journey.
- Illustrations are accessible and do not trigger motion sensitivity issues.

---

## Frontend — Policy detail page: coverage summary, claim history, and renewal CTA

### Description

The policy detail page is the primary reference for a policyholder checking their coverage. It must display coverage parameters, premium paid, expiry countdown, linked claims with their statuses, and a contextual renewal or termination CTA that is enabled or disabled based on on-chain rules. The page must be shareable and render useful content without wallet connection.

### Tasks

- Implement `app/policies/[id]/page.tsx` fetching from `GET /policies/:id` and `GET /claims?policyId=:id`.
- Display coverage summary card, expiry countdown, and premium history.
- List linked claims with status badges and links to claim detail pages.
- Show renewal CTA enabled only within the renewal window; show termination CTA with confirmation modal.
- Add loading skeletons and error boundary for failed fetches.

### Additional Requirements

- Page must render useful content for unauthenticated visitors (public policy data only).
- Renewal and termination CTAs must be hidden for unauthenticated visitors.

### Acceptance Criteria

- Policy detail renders correctly for test fixtures in CI.
- Renewal CTA is disabled outside the renewal window with an explanatory tooltip.
- Linked claims list updates after a new claim is filed without a hard refresh.

---

## Frontend — Claim filing confirmation: summary review step before wallet signing

### Description

Users who sign a `file_claim` transaction without reviewing the details may submit incorrect amounts or evidence. A dedicated review step in the claim wizard showing a summary of all inputs—claim amount, evidence files, policy details—before the wallet signing prompt reduces errors and gives users a final chance to correct mistakes.

### Tasks

- Add a "Review" step as the penultimate step in the claim filing wizard.
- Display claim amount (formatted), evidence file names and hashes, and policy coverage details.
- "Edit" links navigate back to the relevant wizard step without losing other field values.
- "Confirm & Sign" button proceeds to wallet signing only from the review step.
- Add unit tests verifying the review step renders all submitted data correctly.

### Additional Requirements

- Review step must not re-validate fields; validation occurs on the input steps.
- Evidence file names must be truncated if too long for display.

### Acceptance Criteria

- All claim inputs are visible on the review step before signing in manual testing.
- Edit navigation preserves other field values correctly.
- Users cannot skip the review step via URL manipulation.

---

## Frontend — Vote confirmation modal: governance education and irreversibility warning

### Description

Votes on claims are irreversible once submitted on-chain. A confirmation modal before wallet signing must explain this clearly, show the current tally, display the user's chosen vote option prominently, and include a brief explanation of what approve/reject means for the claimant. The modal must be keyboard accessible and dismissible without submitting.

### Tasks

- Implement `VoteConfirmModal` with vote option display, current tally, and irreversibility copy.
- Include a one-sentence governance explainer reviewed by product/legal.
- "Cancel" dismisses without action; "Confirm Vote" proceeds to wallet signing.
- Add `aria-modal` and focus trap; ESC key dismisses.
- Add unit tests for render, dismiss, and confirm paths.

### Additional Requirements

- Copy must not imply that votes are guaranteed to determine the outcome alone.
- Modal must not auto-submit on mount; require explicit user confirmation.

### Acceptance Criteria

- Modal renders with correct vote option and current tally in unit tests.
- ESC and Cancel both dismiss without submitting.
- Governance copy is reviewed and approved before launch.

---

## Frontend — Transaction status polling: unified hook for all on-chain operations

### Description

Policy initiation, claim filing, and vote submission all follow the same pattern: submit a signed transaction, poll until confirmed or failed, then update UI. A shared `useTransactionStatus(txHash)` hook encapsulating this polling logic with exponential backoff, timeout handling, and status normalization reduces duplication and ensures consistent UX across all transaction flows.

### Tasks

- Implement `useTransactionStatus(txHash: string | null)` returning `{ status, error, explorerUrl }`.
- Poll `GET /tx/status/:hash` with exponential backoff (1s, 2s, 4s... up to 30s max interval).
- Stop polling on terminal states (`SUCCESS`, `FAILED`, `NOT_FOUND_TIMEOUT`).
- Return explorer URL for the correct network on terminal states.
- Add unit tests for each terminal state and timeout behavior.

### Additional Requirements

- Hook must clean up polling on unmount to prevent memory leaks.
- `NOT_FOUND_TIMEOUT` after a configurable duration must show a support guidance message.

### Acceptance Criteria

- All transaction flows use the shared hook with no duplicated polling logic.
- Polling stops correctly on terminal states in unit tests.
- Timeout state shows actionable guidance rather than an infinite spinner.

---

## Frontend — Responsive table component: horizontal scroll with sticky first column

### Description

Policy and claim tables with many columns break on mobile without horizontal scrolling. A responsive table component with a sticky first column (policy/claim ID) allows users to scroll horizontally while keeping the row identifier visible. The component must be accessible with keyboard navigation and screen reader support for table semantics.

### Tasks

- Implement `ResponsiveTable` with sticky first column using CSS `position: sticky`.
- Add horizontal scroll container with visible scrollbar on touch devices.
- Ensure `<th>` and `<td>` elements maintain correct ARIA table semantics.
- Add keyboard navigation support for horizontal scrolling.
- Test at 375px, 768px, and 1280px viewport widths.

### Additional Requirements

- Sticky column must not overlap content on very narrow viewports; document minimum supported width.
- Table must not cause horizontal overflow on the page body.

### Acceptance Criteria

- First column remains visible during horizontal scroll at 375px in manual testing.
- Screen readers announce table headers correctly for each cell.
- No horizontal overflow on the page body at any supported viewport width.

---

## Frontend — Error boundary per route segment: isolated failure containment

### Description

A JavaScript error in the claims board must not crash the entire application including the navigation and wallet connection. Route-segment error boundaries using Next.js `error.tsx` files contain failures to the affected section, display a recovery UI, and allow users to retry or navigate away without a full page reload.

### Tasks

- Add `error.tsx` files for `app/policies/`, `app/claims/`, and `app/admin/` route segments.
- Each error boundary shows a contextual error message, a retry button, and a link to the dashboard.
- Log error details to the observability service (anonymized, no PII).
- Add unit tests simulating component errors and verifying boundary render.
- Document the error boundary hierarchy in the frontend architecture notes.

### Additional Requirements

- Error boundaries must not catch wallet signing errors; those are handled inline.
- Retry button must reset the error boundary state and re-render the route segment.

### Acceptance Criteria

- A simulated error in the claims board does not affect the policies page or navigation.
- Retry button successfully re-renders the segment after a transient error.
- Error details are logged to observability without exposing stack traces to users.

---

## Frontend — Cookie consent banner: GDPR-compliant with analytics gating

### Description

If analytics or any tracking scripts are enabled, a cookie consent banner is required for EU users. The banner must appear before any analytics scripts fire, persist the user's choice in `localStorage`, and provide a clear opt-out path. Analytics must be gated on consent status; the banner must not appear for users who have already consented or declined.

### Tasks

- Implement `CookieConsentBanner` component rendering before analytics script injection.
- Gate analytics script loading on `consent === 'accepted'` from `localStorage`.
- Provide "Accept", "Decline", and "Learn More" (links to Privacy page) actions.
- Persist consent choice with a 365-day expiry; re-prompt after expiry.
- Add unit tests for consent gating, persistence, and re-prompt logic.

### Additional Requirements

- Banner must not block page interaction; render as a bottom bar, not a modal overlay.
- Declining must be as easy as accepting; no dark patterns.

### Acceptance Criteria

- Analytics scripts do not fire before consent is given in tests.
- Banner does not re-appear within the consent validity period.
- Declining consent prevents all analytics events for the session.

---

## Frontend — Storybook setup: isolated component development and visual regression baseline

### Description

Developing UI components in isolation with Storybook accelerates design iteration and provides a visual regression baseline. Stories for core design system components, form elements, and status badges allow designers and engineers to review components without running the full application. Visual regression snapshots in CI catch unintended style changes.

### Tasks

- Configure Storybook for Next.js with Tailwind support.
- Add stories for `Button`, `Input`, `StatusBadge`, `WalletAddress`, `LedgerCountdown`, and `SkeletonRow`.
- Add a CI job running Storybook build to catch configuration errors.
- Optional: add Chromatic or Percy for visual regression snapshots.
- Document the story naming convention and how to add new stories.

### Additional Requirements

- Stories must not require a running backend or wallet connection.
- Mock data for stories must be checked into the repo alongside the story files.

### Acceptance Criteria

- Storybook builds successfully in CI without errors.
- Core design system components have at least one story each.
- Visual regression baseline is established and documented if a snapshot tool is adopted.

---

## Frontend — Offline detection: graceful degradation and reconnection UX

### Description

Users on mobile networks may lose connectivity mid-session. Detecting offline state and showing a non-blocking banner, pausing background refetch, and queuing read-retry attempts ensures the app degrades gracefully rather than showing confusing error states. Reconnection must resume normal operation automatically without requiring a page reload.

### Tasks

- Implement `useNetworkStatus()` hook using `navigator.onLine` and `online`/`offline` events.
- Show a persistent banner when offline; dismiss automatically on reconnection.
- Pause React Query background refetch when offline; resume on reconnection.
- Queue failed read requests for retry on reconnection (writes should not be auto-retried).
- Add unit tests for offline detection, banner render, and reconnection resume.

### Additional Requirements

- Offline banner must not block primary content or CTAs.
- Write operations (transaction submission) must show a clear error, not queue silently.

### Acceptance Criteria

- Offline banner appears within 1 second of network loss in manual testing.
- Background refetch resumes automatically on reconnection without page reload.
- Failed write operations show an error with a manual retry option.

---
