# NiffyInsure — 125 Tracked Issues Backlog

> Generated from a comprehensive codebase audit of `niff-Stellar-shurance`.
> Issues are grouped by domain. Each issue includes a title, layer(s), priority,
> and description following the [cross-stack linking convention](./cross-stack-linking-convention.md).

---

## Smart Contract (Soroban / Rust)

### Issue #1001 — Contract: Add coverage-tier enum to replace free-text coverage type field
**Layer:** Contract | **Priority:** High

Replace the current free-text `coverage_type` field on `Policy` with a closed `CoverageType` enum
(`Basic | Standard | Premium`). This prevents invalid strings, simplifies premium table lookups,
and makes XDR encoding deterministic. Update `policy.rs`, `types.rs`, and the multiplier lookup in
`premium.rs`. Requires a storage migration for existing policies and a `CHANGELOG.md` entry.

---

### Issue #1002 — Contract: Implement configurable voting deadline (admin-tunable ledger offset)
**Layer:** Contract | **Priority:** High

`VoteDurLedgers` is stored as an instance-tier key but there is no entrypoint to mutate it after
initialization. Add a `set_vote_dur_ledgers(new_dur: u32)` admin entrypoint guarded by `GovernanceCooldownLedgers`
to prevent rapid parameter changes. Emit a `vote_dur_updated` event. Update `storage.rs` and
`admin.rs`. Add a test asserting the cooldown guard fires correctly.

---

### Issue #1003 — Contract: Implement deductible model with per-policy payout adjustment
**Layer:** Contract | **Priority:** High

Add a `deductible: i128` field to `Policy` (set at bind time, immutable thereafter). When a claim
is approved, subtract the deductible from the payout before transferring. If `claim_amount ≤ deductible`,
payout is zero but the claim still resolves as `Approved`. Document the edge case in `docs/GLOSSARY.md`.
Ensure rolling-claim-cap accounting uses the net payout, not the gross claim amount.

---

### Issue #1004 — Contract: Add grace-period config entrypoint (admin-settable GracePeriodLedgers)
**Layer:** Contract | **Priority:** Medium

`GracePeriodLedgers` is stored in instance storage but only set at initialization. Add
`set_grace_period_ledgers(ledgers: u32)` admin entrypoint. Validate that the new value does not
exceed a protocol-wide maximum (e.g., 30 days in ledgers). Emit a `grace_period_updated` event.
Cover with a test that policies expiring after the change use the new grace period.

---

### Issue #1005 — Contract: Evidence hash commitment — store SHA-256 digest alongside URL
**Layer:** Contract | **Priority:** High

Currently evidence is stored as an IPFS URL string only. Add an optional `hash: BytesN<32>` field
to the evidence struct so claimants can commit a SHA-256 digest at filing time. Backend verifies the
hash against the file at IPFS upload time. This provides tamper-evidence if the IPFS CID rotates.
Guard the hash field as optional for backward compatibility with existing claims.

---

### Issue #1006 — Contract: Voter snapshot TTL — add expiry and refresh logic
**Layer:** Contract | **Priority:** High

`ClaimVoters(u64)` is a persistent-tier key but has no TTL enforcement beyond natural Soroban
expiration. Add a `voter_snapshot_version` field to the claim record so admin can trigger a snapshot
refresh on active claims if the voter registry changes significantly between filing and finalization.
Add `refresh_voter_snapshot(claim_id: u64)` admin entrypoint with a guard preventing refresh after
voting has started.

---

### Issue #1007 — Contract: Multi-sig admin pattern — two-step confirmation for treasury sweeps
**Layer:** Contract | **Priority:** Critical

The `PendingAdminAction` pattern exists but the sweep path still allows single-admin execution after
the notice period elapses. Extend the confirmation step to require a second distinct admin address
(a `co_signer` field on `PendingAdminAction`). If `co_signer == admin`, the confirmation is rejected.
Document the pattern in `SECURITY.md`. Add a `tests/multisig_sweep.rs` integration test.

---

### Issue #1008 — Contract: Batch query entrypoints — fetch multiple policies/claims efficiently
**Layer:** Contract | **Priority:** Medium

Add `get_policies_batch(holder: Address, ids: Vec<u32>)` and `get_claims_batch(ids: Vec<u64>)`
read-only entrypoints. Cap the batch size at a protocol constant (`MAX_BATCH_SIZE = 20`) to avoid
instruction budget overruns. These entrypoints avoid the N+1 RPC call pattern on the frontend and
indexer. Validate the cap in both entrypoints and return a `BatchTooLarge` error when exceeded.

---

### Issue #1009 — Contract: Status history log — append-only transition trail for claims
**Layer:** Contract | **Priority:** Medium

Add a `StatusTransition { from: ClaimStatus, to: ClaimStatus, ledger: u32 }` struct and a
`ClaimStatusHistory(u64)` persistent-tier key storing `Vec<StatusTransition>`. Append to it on every
status change in `claim.rs`. Cap the vec length at 20 entries (enough for full lifecycle). This
enables the frontend claim timeline and removes the need for backend to reconstruct history from events.

---

### Issue #1010 — Contract: Keeper entrypoints — permissionless expiry and deadline processing
**Layer:** Contract | **Priority:** High

Add `process_expired_policies(holder: Address, policy_id: u32)` and `finalize_stale_claim(claim_id: u64)`
as permissionless keeper entrypoints. Any address can call them; the contract checks conditions
internally and reverts with `NothingToProcess` if not eligible. Emit `policy_expired` / `claim_finalized`
events. Backend keeper job calls these on schedule (see Issue #1073). Add a smoke test asserting
a non-eligible call returns `NothingToProcess`.

---

### Issue #1011 — Contract: Treasury balance entrypoint for solvency visibility
**Layer:** Contract | **Priority:** Medium

Add `get_treasury_balance()` view entrypoint that returns the SEP-41 token balance of the `Treasury`
address. Expose `get_min_solvency_ratio_bps()` alongside it so callers can compute the health ratio
client-side. This feeds the admin dashboard solvency widget (Issue #1085) and the
`treasury.balance_low` webhook event.

---

### Issue #1012 — Contract: Configurable max appeals per claim (currently hardcoded to 1)
**Layer:** Contract | **Priority:** Low

`MAX_APPEALS_PER_CLAIM` is a compile-time constant. Move it to instance storage as `MaxAppealsPerClaim: u32`
settable by admin. Validate the new value is between 1 and 3. Emit an `appeals_cap_updated` event.
This future-proofs the contract without breaking existing claims (the new cap only applies to claims
filed after the change).

---

### Issue #1013 — Contract: Governance proposal expiry — auto-reject proposals past deadline
**Layer:** Contract | **Priority:** Medium

`GovernanceProposal` records have a `deadline_ledger` field, but there is no entrypoint or automatic
mechanism to close expired proposals. Add `finalize_governance_proposal(proposal_id: u64)` permissionless
keeper that checks `env.ledger().sequence() > deadline_ledger` and transitions status from `Active`
to `Expired`. Emit a `proposal_expired` event. Guards: cannot finalize an already-closed proposal.

---

### Issue #1014 — Contract: Event replay protection — per-holder nonce for state-mutating calls
**Layer:** Contract | **Priority:** High

`HolderNonce(Address)` exists in persistent storage but is not enforced on `file_claim` or `initiate_policy`.
Add nonce validation to both entrypoints: callers pass an expected nonce, the contract increments it
and rejects mismatches with `NonceMismatch`. This prevents replay attacks in situations where a signed
transaction is captured and rebroadcast. Add a test reproducing a replay attempt.

---

### Issue #1015 — Contract: Region registry admin entrypoint — add/update/remove region configs
**Layer:** Contract | **Priority:** Medium

`RegionRegistry` is stored as `Map<String, RegionConfig>` but there is no public entrypoint to mutate
it after initialization. Add `upsert_region(region: String, config: RegionConfig)` and
`remove_region(region: String)` admin entrypoints. Validate the region string against a max-length
constant. Emit `region_upserted` / `region_removed` events. Update docs in `docs/GLOSSARY.md`.

---

### Issue #1016 — Contract: Rolling claim cap — per-policy cumulative limit with window reset
**Layer:** Contract | **Priority:** High

The `RollingClaimState(Address, u32)` key and `rolling_claim_cap.rs` module exist but the
integration with `claim.rs` on payout approval needs hardening: confirm the cap deduction happens
atomically inside the payout transaction, not as a separate call. Add a test that files claims up
to the cap, verifies the cap error, waits for the window to elapse, and files again successfully.

---

### Issue #1017 — Contract: Oracle: sign-then-verify pipeline for price feed data
**Layer:** Contract | **Priority:** High

The `oracle.rs` module is behind `#[cfg(feature = "experimental")]`. Implement the full
sign-then-verify flow: oracle posts a `(price, timestamp, nonce)` tuple signed with its Ed25519
key (`OraclePubKey`). Contract verifies the signature via `ed25519_verify`, increments `OracleNonce`,
checks quorum, and updates the price feed. Add comprehensive tests covering key rotation,
nonce mismatch, and quorum failure.

---

### Issue #1018 — Contract: KYC whitelist entrypoint — register/deregister addresses
**Layer:** Contract | **Priority:** Medium

`Whitelisted(Address)` and `WhitelistEnabled` exist in storage but there are no admin entrypoints to
manage the whitelist. Add `whitelist_address(addr: Address)` and `remove_from_whitelist(addr: Address)`
admin entrypoints. When `WhitelistEnabled = true`, guard `initiate_policy` with a whitelist check.
Emit `address_whitelisted` / `address_dewhitelisted` events.

---

### Issue #1019 — Contract: Vet specialization validation — reject claims without matching vet
**Layer:** Contract | **Priority:** Medium

`VetSpecializations(Address)` stores vet specializations per address but claim filing does not
validate that a registered vet with the required specialization exists. Add a `required_specialization: Option<String>`
field to `Claim` and a validation step in `file_claim` that checks against the vet registry when
the field is set. Return `VetNotFound` if no registered vet matches.

---

### Issue #1020 — Contract: Reinsurance fallback — trigger payout from ReinsuranceContract when treasury insufficient
**Layer:** Contract | **Priority:** Medium

`ReinsuranceContract` address is stored in instance storage. Add logic in the claim payout path:
if the treasury balance is insufficient for the approved payout, attempt a fallback call to the
`ReinsuranceContract` via cross-contract call. Emit a `reinsurance_triggered` event. Guard: if
reinsurance also fails, set claim to `PayoutFailed` status and alert via event.

---

### Issue #1021 — Contract: storage_key_uniqueness test — extend to cover all parameterised variants
**Layer:** Contract | **Priority:** Medium

The existing `storage_key_uniqueness` test covers only unit (non-parameterised) variants. Extend it
to generate sample parameterised keys (e.g., `Policy(sample_addr, 0)` and `Policy(sample_addr, 1)`)
and assert they do not collide with each other or with any unit-variant key. This prevents future
storage corruption from discriminant reuse. Track in `docs/storage-keys.md`.

---

### Issue #1022 — Contract: ClaimStatus::Appealed — document and guard reserved variant
**Layer:** Contract | **Priority:** Low

`ClaimStatus::Appealed` is a reserved never-constructed variant kept to avoid XDR renumbering.
Add a compile-time assertion (`const _: () = assert!(...)`) that this variant is never matched as
a live status in the claim lifecycle functions. Document explicitly in `types.rs` with a comment
explaining why it must never be constructed. Add a test asserting the variant cannot transition to.

---

### Issue #1023 — Contract: Add `withdraw_claim` entrypoint for pre-voting retraction
**Layer:** Contract | **Priority:** Medium

Allow a claimant to retract a claim before the voting window opens. Guard: `claim.status == Processing`
AND `env.ledger().sequence() < voting_start_ledger`. Set status to `Withdrawn` and refund any
claim deposit if applicable. Emit a `claim_withdrawn` event. Add a new `Withdrawn` variant to
`ClaimStatus` and update all match statements. Document in `docs/GLOSSARY.md`.

---

### Issue #1024 — Contract: Subscription counter and EventSubscription storage — add admin CRUD
**Layer:** Contract | **Priority:** Low

`SubscriptionCounter`, `Subscription(u64)`, and `OwnerSubscriptionIds(Address)` are defined in
storage but have no entrypoints for creation or deletion. Add `subscribe_to_events(events: Vec<String>, callback: Address)`
and `unsubscribe(sub_id: u64)` entrypoints. Validate the callback address is on the `AllowedPayoutRecipient`
allowlist. Emit `subscription_created` and `subscription_cancelled` events.

---

### Issue #1025 — Contract: Add `get_contract_version()` metadata entrypoint
**Layer:** Contract | **Priority:** Low

Add a `get_contract_version() -> (u32, u32, u32)` view entrypoint returning `(major, minor, patch)`
as compile-time constants from `Cargo.toml`. This allows the backend and frontend to verify they
are connected to the expected contract version before making state-mutating calls. Document the
versioning scheme in `docs/api-versioning-policy.md`.

---

## Backend (NestJS / TypeScript)

### Issue #1026 — Backend: SSE real-time updates — Redis pub/sub for multi-instance claim status
**Layer:** Backend | **Priority:** High

As documented in `docs/claim-notification-latency.md`, the current SSE implementation uses an
in-process `ClaimsService.statusListeners` map. This breaks in multi-instance deployments. Replace
with a Redis pub/sub channel so all instances publish and subscribe to the same channel. When an
indexer processes a `claim_finalized` event, it publishes to `claim:status:<claimId>` on Redis;
all SSE handlers subscribe and forward to connected clients.

---

### Issue #1027 — Backend: Simulation cache — Redis TTL layer for quote/premium responses
**Layer:** Backend | **Priority:** High

Quote simulation calls to Soroban RPC are expensive (~2 s p95). Add a Redis cache layer in
`QuoteService.simulatePremium` keyed by a hash of `(coverage_type, tier, region, amount, asset)`.
Use a configurable `QUOTE_CACHE_TTL_SECONDS` (default 300 s). Log cache hits vs misses to Prometheus.
Invalidate on `premium_table_updated` events from the indexer.

---

### Issue #1028 — Backend: Horizon proxy — filtered transaction history without exposing API keys
**Layer:** Backend | **Priority:** Medium

Add `GET /api/horizon/transactions?account=<address>` proxy endpoint in the `horizon` module.
Strip all internal auth headers before forwarding to Horizon. Apply rate limiting per wallet address.
Return a subset of Horizon fields (txHash, fee, ledger, createdAt, operationType) without leaking
RPC keys. Document the stripped fields vs full Horizon response in the OpenAPI spec.

---

### Issue #1029 — Backend: Claim aggregation service — pre-computed quorum and deadline metrics
**Layer:** Backend | **Priority:** Medium

Add a `ClaimAggregationService` that runs on a BullMQ scheduled job (every ledger close event)
computing: total votes cast, approval/rejection split, quorum percentage, and ledgers remaining.
Store results in a `claim_aggregation` table. The claims detail endpoint serves these pre-computed
values instead of computing them on every request, reducing p95 from >1 s on high-vote claims.

---

### Issue #1030 — Backend: Address normalization — M-format enforcement across all Prisma models
**Layer:** Backend | **Priority:** High

As noted in the backlog, addresses must be stored in Stellar M-format. Audit all `Prisma` model
fields of type `String` that hold Stellar addresses (`holder`, `walletAddress`, `voter`, etc.) and
add a middleware interceptor that normalizes all incoming addresses to M-format before DB writes.
Add a CI job (or existing `address-normalization` job) that queries a sample of DB records and
asserts no G-format addresses exist.

---

### Issue #1031 — Backend: Keeper job — auto-finalize expired policies via contract entrypoint
**Layer:** Backend | **Priority:** High

Implement a BullMQ cron job in the `jobs` module that runs every ~30 s, queries
`policies WHERE status = 'active' AND expiry_ledger < current_ledger`, and calls the
`process_expired_policies` contract entrypoint (Issue #1010) for each. Cap batch size at 10 per run.
Emit a `policy.expired` backend event and trigger the outbound webhook (see `webhooks-outbound.md`).
Add a circuit breaker for RPC failures.

---

### Issue #1032 — Backend: Keeper job — auto-finalize stale appeal rounds
**Layer:** Backend | **Priority:** High

Add a BullMQ cron job in `appeal-finalize-keeper-job` (scaffold exists in `docs/ops/appeal-finalize-keeper-job.md`)
that queries claims in `UnderAppeal` status past their `appeal_deadline_ledger` and calls
`finalize_appeal` on-chain. Handle `VotingWindowStillOpen` gracefully (skip and retry next cycle).
Log finalization results to the existing `AppLoggerService`. Track in `docs/ops/appeal-finalize-keeper-job.md`.

---

### Issue #1033 — Backend: Support center — tickets, replies, CAPTCHA, and FAQ endpoints
**Layer:** Backend | **Priority:** Medium

Scaffold the `SupportModule` (`backend/src/support/`) with entities `SupportTicket` and
`SupportReply`. Implement `POST /api/support/tickets` (with CAPTCHA validation), `GET /api/support/tickets/:id`,
`POST /api/support/tickets/:id/replies`. Add admin endpoints `GET /admin/support/tickets` with
filtering by status. Integrate with the notification module to email the user on status changes.

---

### Issue #1034 — Backend: Posts/announcements — sanitization, scheduling, and feeds
**Layer:** Backend | **Priority:** Medium

Implement the `PostsModule` scaffolded at `backend/src/posts/`. Add `Post` Prisma model with
`title`, `body` (HTML, sanitized via DOMPurify equivalent), `status` (draft/scheduled/published),
`publishAt`, `authorId`. Implement CRUD admin endpoints and `GET /api/posts` public feed with
pagination. Emit `post.published` event. Sanitize HTML server-side using a library like `sanitize-html`.

---

### Issue #1035 — Backend: Claim discussion threads — comment moderation and soft-delete
**Layer:** Backend | **Priority:** Medium

The comment soft-delete audit trail was added in commit `#1569`. Complete the moderation workflow:
add `PATCH /admin/claims/:id/comments/:commentId` for admin edit/hide, implement `GET /api/claims/:id/comments`
with pagination, and add a `ClaimComment` BullMQ job for async notification when a reply is posted.
Add rate limiting per wallet address (max 5 comments per claim per hour).

---

### Issue #1036 — Backend: Vote delegation UI backend — expose delegation CRUD endpoints
**Layer:** Backend | **Priority:** Medium

The `delegation.rs` contract module handles on-chain delegation, but the backend lacks REST endpoints
for it. Add `POST /api/governance/delegations` (build delegation transaction), `GET /api/governance/delegations/:address`
(fetch current delegation), `DELETE /api/governance/delegations/:address` (build undelegate transaction).
Link to the frontend delegation UI (Issue #1097).

---

### Issue #1037 — Backend: GraphQL mutation for claim escalation
**Layer:** Backend | **Priority:** Medium

The `escalate_claim` contract entrypoint exists but the GraphQL API only exposes it via REST.
Add `escalateClaim(claimId: ID!, newDeadlineLedger: Int!)` GraphQL mutation in the `GraphqlApiModule`.
Apply the existing `AdminGuard`. Add depth/complexity weight of 10 to prevent abuse. Update the
OpenAPI spec to reflect parity between REST and GraphQL claim admin actions.

---

### Issue #1038 — Backend: Idempotency middleware — extend to cover PATCH policy renewal
**Layer:** Backend | **Priority:** Medium

The `IDEMPOTENCY_ROUTES` constant in `app.module.ts` covers `POST /claims`, `POST /policies`,
and `POST /tx/submit`. Policy renewal via `PATCH /policies/:id/renew` is also a state-mutating
operation that should require an idempotency key. Add `{ path: 'policies/:id/renew', method: RequestMethod.PATCH }`
to the routes list. Update API docs and OpenAPI spec.

---

### Issue #1039 — Backend: Multi-tenant query isolation — add tenantId filter to all Prisma queries
**Layer:** Backend | **Priority:** High

Audit all Prisma `findMany`, `findFirst`, `findUnique`, and mutation calls across all modules.
Ensure every query that operates on multi-tenant entities (`Claim`, `Policy`, `Vote`, `Profile`)
includes a `where: { tenantId: currentTenantId }` clause. Add a Prisma middleware that throws
if a query on a tenant-scoped model runs without a tenantId filter. Add a unit test asserting
cross-tenant data cannot be read.

---

### Issue #1040 — Backend: Correlation ID propagation — enforce X-Correlation-ID across all responses
**Layer:** Backend | **Priority:** Medium

Per `docs/correlation-id-guide.md`, every response must include `X-Correlation-ID`. Audit the
`RequestContextMiddleware` to ensure the header is set on all responses including 4xx/5xx. Add
a test that sends a request with a custom `X-Correlation-ID` and asserts the same value appears
in the response. Add a Prometheus counter `correlation_id_missing_total` for requests missing the header.

---

### Issue #1041 — Backend: API deprecation headers — V1 sunset interceptor coverage
**Layer:** Backend | **Priority:** Medium

`V1SunsetInterceptor` exists in `common/versioning/` but its scope of routes may not cover all
v1 endpoints. Audit all `@Controller` classes for routes that respond to `/api/v1/` paths and are
not yet covered. Add the interceptor to the `APP_INTERCEPTOR` list or apply it at the module level.
Document the v1 sunset date in `docs/api-deprecation-policy.md`.

---

### Issue #1042 — Backend: Webhook delivery retry — exponential backoff with dead-letter queue
**Layer:** Backend | **Priority:** Medium

Per `docs/webhooks-outbound.md`, retries use 1s→2s→4s→8s→16s backoff (5 attempts). After all
retries are exhausted, move the delivery to a `webhook_dlq` (dead-letter queue) table with
`failed_at` timestamp. Add `GET /admin/webhooks/dlq` endpoint for ops to view and
`POST /admin/webhooks/dlq/:id/retry` to manually re-enqueue. Alert when DLQ size exceeds threshold.

---

### Issue #1043 — Backend: Dependency register — complete first quarterly review
**Layer:** Backend | **Priority:** Low

Per `docs/dependency-register.md`, the first quarterly review is marked `_(none yet — first review pending)_`.
Complete the initial review: run `npm audit` and `cargo audit`, update the `Known CVE status` column
for all entries, record the reviewer and date in the review log. Set a calendar reminder for Q1 2027.

---

### Issue #1044 — Backend: Feature flag cleanup — audit deprecated flags and remove dead code
**Layer:** Backend | **Priority:** Low

Per `docs/feature-flags.md`, `deprecated` flags whose guarded code has already been deleted are
safe to remove immediately. Audit all keys in `ALLOWED_FLAG_KEYS` against the lifecycle stages in
`docs/feature-flag-naming-convention.md`. File individual cleanup PRs for each deprecated flag.
Add a CI lint that fails if a flag in `ALLOWED_FLAG_KEYS` is marked `deprecated` for more than
one release cycle.

---

### Issue #1045 — Backend: Golden vector refresh automation — post-contract-change CI gate
**Layer:** Backend | **Priority:** Medium

Golden vectors at `backend/src/soroban/golden-vectors.json` require manual `npm run refresh-vectors`
after contract changes. Add a CI step that runs `refresh-vectors` in a sandboxed environment and
diffs the output against the committed file. Fail the build if the vectors are stale. Require
2-approver sign-off when the diff file changes, consistent with existing policy.

---

### Issue #1046 — Backend: Metrics module — add custom Prometheus metrics for business KPIs
**Layer:** Backend | **Priority:** Medium

The `MetricsModule` exposes default NestJS/Node metrics. Add custom business metrics:
`claims_filed_total` (counter), `claims_resolved_total{status}` (counter by status),
`active_policies_gauge` (gauge), `treasury_balance_gauge` (gauge, updated from `get_treasury_balance`),
`indexer_ledger_lag` (gauge). Expose via `/metrics` endpoint. Add Grafana dashboard JSON
at `docs/ops/grafana-dashboard.json`.

---

### Issue #1047 — Backend: Admin dashboard APIs — voter registration, pause, and config endpoints
**Layer:** Backend | **Priority:** High

The `AdminModule` is scaffolded. Implement the missing admin REST endpoints:
`POST /admin/voters/register`, `DELETE /admin/voters/:address`, `POST /admin/pause`,
`POST /admin/unpause`, `PATCH /admin/protocol-params` (quorum, voting duration, grace period).
All endpoints require the `AdminGuard`. Return `202 Accepted` with a pending transaction XDR that
the admin signs and submits via `/api/tx/submit`.

---

### Issue #1048 — Backend: Maintenance module — scheduled data cleanup for expired soft-deleted records
**Layer:** Backend | **Priority:** Low

The `MaintenanceModule` exists but the cleanup schedule is not documented. Implement:
1. Purge `deletedAt IS NOT NULL` records older than 90 days from `ClaimComment`.
2. Archive resolved claims older than 2 years to a `claim_archive` table.
3. Purge expired feature flags.
Schedule via `@Cron` decorator (weekly, off-peak). Log purge counts to structured logger.

---

### Issue #1049 — Backend: Ramp module — fiat on/off-ramp integration for premium payments
**Layer:** Backend | **Priority:** Medium

The `RampModule` is scaffolded at `backend/src/ramp/`. Implement integration with a fiat ramp
provider (e.g., Transak or MoonPay) to allow premium payments in fiat currency. Add
`POST /api/ramp/quote` and `POST /api/ramp/initiate` endpoints. Store ramp transactions in a
`ramp_transaction` Prisma model. Emit `ramp.completed` event on successful funding.

---

### Issue #1050 — Backend: Assets module — SEP-41 token allowlist management
**Layer:** Backend | **Priority:** Medium

The `AssetsModule` exists but lacks endpoints for managing the contract's `AllowedAsset` allowlist.
Add `GET /api/assets` (list allowed assets with metadata), `POST /admin/assets` (add to allowlist — builds
admin transaction), `DELETE /admin/assets/:contractId` (remove from allowlist). Cache the allowlist
in Redis with a 60 s TTL. Invalidate on `allowed_asset_updated` indexer event.

---

### Issue #1051 — Backend: Profile module — display name, avatar, and notification preferences
**Layer:** Backend | **Priority:** Medium

The `ProfileModule` exists. Complete the implementation:
`GET /api/profile` (own profile), `PATCH /api/profile` (update displayName, avatarUrl, notificationPrefs).
Add `notification_prefs` JSONB column to the `Profile` Prisma model. Validate `avatarUrl` is
an HTTPS URL pointing to an allowed CDN. Return the profile in the `useFeatureFlag` hook context
so the frontend nav can display the display name.

---

### Issue #1052 — Backend: Feeds module — paginated activity feed for wallet address
**Layer:** Backend | **Priority:** Medium

Implement `GET /api/feeds/activity?address=<addr>&cursor=<cursor>&limit=20` returning a chronological
activity feed of on-chain events (policy created, claim filed, vote cast, payout received) for a
given wallet address. Source from the indexed events table. Use cursor-based pagination (keyed on
`(ledger, tx_index)`) to avoid offset drift. Return events in the `ActivityFeedItemDto` envelope.

---

### Issue #1053 — Backend: Chain module — multi-network support (testnet/mainnet routing)
**Layer:** Backend | **Priority:** High

Per `docs/soroban-toolchain-policy.md`, the platform supports `testnet | mainnet | futurenet`.
The `ChainModule` currently reads `STELLAR_NETWORK` at startup. Add runtime network validation:
on startup, assert `STELLAR_NETWORK_PASSPHRASE` matches the canonical passphrase for `STELLAR_NETWORK`.
Reject startup if mismatched. Add a `GET /api/chain/info` endpoint returning the active network name
and contract address for client-side verification.

---

### Issue #1054 — Backend: OpenAPI spec — auto-generate and commit on every PR
**Layer:** Backend | **Priority:** Medium

Add a CI step that runs `nest generate swagger` (or equivalent), diffs against `backend/openapi.json`,
and fails if the spec is stale. This ensures `openapi.json` is always in sync with the controllers.
Link to the frontend `make generate-client` step so the TypeScript client types stay in sync
automatically. Update `CONTRIBUTING.md` with the new workflow.

---

### Issue #1055 — Backend: Test coverage — add unit tests for ClaimsService appeal workflow
**Layer:** Backend | **Priority:** High

The appeal workflow (`open_appeal`, `vote_on_appeal`, `finalize_appeal`) has integration tests at
the contract level but limited backend unit tests. Add `claims.service.spec.ts` test cases covering:
- Appeal filing with eligible status
- Appeal rejection on `appeals_count >= MAX_APPEALS_PER_CLAIM`
- `finalize_appeal` at deadline
- Appeal voter snapshot sync from chain

---

### Issue #1056 — Backend: Error catalog — structured RFC7807 error responses across all modules
**Layer:** Backend | **Priority:** Medium

Audit all `throw new HttpException(...)` calls across the codebase. Replace with structured
`ProblemDetailDto { type, title, status, detail, instance, extensions? }` matching RFC7807.
Add i18n keys for all error messages. Add a test that every 4xx response from the API includes
a `type` field matching the error catalog. Document the catalog in `docs/api/ERROR_CATALOG.md`.

---

### Issue #1057 — Backend: Log aggregation — structured JSON logs to ELK/Loki
**Layer:** Backend | **Priority:** Medium

Per `docs/ops/log-aggregation.md`, structured logging is expected but may not be fully configured.
Ensure `AppLoggerService` (Winston) outputs JSON-formatted logs in production. Add a `correlation_id`
field to every log line using the `RequestContextMiddleware`. Add a Loki/ELK shipper configuration
example to `docs/ops/log-aggregation.md`. Validate by running in Docker and checking JSON output.

---

### Issue #1058 — Backend: TLS certificate monitoring — automated expiry alerts
**Layer:** Backend | **Priority:** Medium

Per `docs/ops/tls-cert-monitoring.md`, TLS cert expiry monitoring is referenced. Implement:
a cron job that reads TLS endpoint configs from `config/tls-endpoints.example.json`, checks
certificate expiry via TLS handshake, and emits a Prometheus metric `tls_cert_expiry_days{domain}`.
Alert at 30 days and 7 days before expiry. Document the alert thresholds in `docs/ops/tls-cert-monitoring.md`.

---

### Issue #1059 — Backend: Soroban SDK upgrade to v26.x — follow upgrade checklist
**Layer:** Backend | **Priority:** Medium

Per `docs/sdk-upgrade-checklist.md`, `soroban-sdk v26.x` is `Not yet tested`. Initiate the
upgrade process: assign an owner, complete the pre-upgrade checklist (sections 1–8 in the doc),
add the `test (next-minor)` scheduled CI job to `.github/workflows/sdk-compat.yml`, and document
findings in the compatibility matrix. Do not merge until all checklist items are checked.

---

### Issue #1060 — Backend: Rate limiting — per-wallet endpoint-specific limits for claim filing
**Layer:** Backend | **Priority:** High

The current throttler applies a global 120 req/60 s limit per identity. Add endpoint-specific
limits for high-cost operations: `POST /api/claims` → 3 per hour per wallet, `POST /api/tx/submit`
→ 10 per minute per wallet. Use the `RedisThrottlerStorage` already integrated. Return 429 with
`Retry-After` header. Add a test asserting the claim filing rate limit fires and returns 429.

---

### Issue #1061 — Backend: Webhook SSRF — periodic re-validation of existing subscription URLs
**Layer:** Backend | **Priority:** High

Per `docs/webhooks-outbound.md`, SSRF validation runs on create and update. However, a DNS rebinding
attack could occur after a subscription is created. Add a daily cron job that re-validates all
active subscription URLs (DNS resolution + private IP check). Disable subscriptions that fail
re-validation and notify the tenant via email. Log results to `webhook_ssrf_audit` table.

---

### Issue #1062 — Backend: BullMQ dead-letter queue dashboard — admin endpoint for queue inspection
**Layer:** Backend | **Priority:** Low

Add `GET /admin/queues/:queueName/failed` and `POST /admin/queues/:queueName/failed/:jobId/retry`
endpoints to the `AdminModule`. These wrap the BullMQ `Queue.getFailed()` and `job.retry()` APIs.
Useful for ops when the webhook DLQ (Issue #1042) or indexer jobs fail silently. Require the
`AdminGuard`. Document in `docs/ops/queue-replay-runbook.md`.

---

### Issue #1063 — Backend: Privacy runbook — implement GDPR right-to-erasure for off-chain data
**Layer:** Backend | **Priority:** High

Per `docs/ops/privacy-runbook.md`, the right-to-erasure workflow is documented but the backend
implementation is incomplete. Implement `DELETE /api/profile` which:
1. Anonymizes `Profile.displayName` and `Profile.email` to hashed placeholders.
2. Soft-deletes all `ClaimComment` records by the user.
3. Emits a `privacy.erasure_completed` event.
Note: on-chain data is immutable and outside GDPR scope — document this explicitly.

---

### Issue #1064 — Backend: Secret rotation — automate rotation schedule in CI
**Layer:** Backend | **Priority:** Medium

Per `docs/ops/.secret-rotation-dates.json`, rotation dates are tracked manually. Add a CI step
that reads this file and emits a warning annotation if any secret has not been rotated within
its declared rotation interval. Integrate with the `secrets-management-runbook.md`. Alert the
on-call engineer 14 days before each rotation deadline.

---

## Frontend (Next.js / React)

### Issue #1065 — Frontend: Admin dashboard — voter registration page
**Layer:** Frontend | **Priority:** High

Implement the admin voter registration page at `frontend/src/app/admin/voters/page.tsx`.
Display the voter registry with wallet address and registration date. Add a form to register new
voters (calls backend `POST /admin/voters/register`) and a remove button. Require admin session.
Use the existing `AdminGuard` pattern from other admin pages. Add a Storybook story.

---

### Issue #1066 — Frontend: Admin dashboard — protocol parameter management page
**Layer:** Frontend | **Priority:** High

Add `frontend/src/app/admin/params/page.tsx` for editing protocol parameters: quorum BPS,
voting duration, grace period, fraud score threshold, rolling claim cap. Each field maps to
`PATCH /admin/protocol-params`. Show current on-chain values fetched via `get_contract_version`
and the treasury balance widget (Issue #1011). Require 2-step confirmation before submitting changes.

---

### Issue #1067 — Frontend: Admin dashboard — treasury and solvency widget
**Layer:** Frontend | **Priority:** High

Add a treasury health card to the admin dashboard: current treasury balance, minimum solvency ratio
(from `get_min_solvency_ratio_bps`), and a visual indicator (green/yellow/red). Poll every 60 s.
Show a `treasury.balance_low` warning banner when balance is below `1.2 × MinSolvencyRatio`. Link
to the `docs/ops/disaster-recovery-runbook.md` for ops guidance.

---

### Issue #1068 — Frontend: Vote delegation UI — build delegation flow
**Layer:** Frontend | **Priority:** Medium

Implement delegation flow at `frontend/src/app/governance/delegation/page.tsx`:
1. Show current delegation status (delegated to / not delegated).
2. Address input for delegate wallet.
3. Build and sign delegation transaction via `useContractTx`.
4. Show undelegate button if delegation is active.
Link to backend Issue #1036. Add the `useGovernance` hook delegation methods.

---

### Issue #1069 — Frontend: Claim discussion thread — reply, pagination, and moderation UI
**Layer:** Frontend | **Priority:** Medium

Build out the claim discussion thread UI in `frontend/src/components/discussion/`.
Add reply form with character limit (500 chars). Implement cursor-based pagination for comments.
Show a `[removed]` placeholder for soft-deleted comments. Display commenter wallet address with
display name if available (from `ProfileModule`). Rate-limit UI: disable the reply button for 60 s
after submission.

---

### Issue #1070 — Frontend: Support center UI — ticket submission and FAQ
**Layer:** Frontend | **Priority:** Medium

Implement `frontend/src/app/support/page.tsx`: tabbed layout with a FAQ section (populated from
`frontend/src/lib/faq-data.ts`) and a ticket submission form (calls `POST /api/support/tickets`).
Add CAPTCHA integration (hCaptcha). Display ticket history `GET /api/support/tickets` when
the user is authenticated. Add toast notifications on ticket submission success/failure.

---

### Issue #1071 — Frontend: Posts/announcements feed — platform news page
**Layer:** Frontend | **Priority:** Medium

Add `frontend/src/app/docs/announcements/page.tsx` rendering the post feed from
`GET /api/posts`. Use infinite scroll with cursor-based pagination. Support MDX content rendering
(via `frontend/src/lib/load-mdx.ts`). Add `pubDate` and author metadata to each post card.
Link from the main navigation. Add `announcement_count` badge on the nav item for unread posts.

---

### Issue #1072 — Frontend: OnboardingTour — complete 5-step product tour
**Layer:** Frontend | **Priority:** Low

The `OnboardingTour.tsx` component exists. Implement the 5 tour steps:
1. Welcome + wallet connect prompt.
2. Quote form walkthrough.
3. Policy dashboard overview.
4. Claim filing intro.
5. Governance/voting intro.
Use the `use-onboarding-tour.ts` hook to persist completion state. Ensure the tour is
keyboard-navigable and has `aria-live` announcements for screen readers.

---

### Issue #1073 — Frontend: TxStatusDialog — show transaction status lifecycle with Stellar explorer link
**Layer:** Frontend | **Priority:** Medium

`TxStatusDialog.tsx` exists but may not show all states. Implement complete lifecycle display:
`Pending → Submitted → Confirmed → Failed`. Show the tx hash with a link to Stellar Expert
(`https://stellar.expert/explorer/mainnet/tx/<hash>`). On failure, show the error from the
XDR envelope. Auto-close after 10 s on `Confirmed`. Add haptic feedback on mobile (Vibration API).

---

### Issue #1074 — Frontend: SessionTimeoutModal — implement idle timeout with countdown
**Layer:** Frontend | **Priority:** Medium

`SessionTimeoutModal.tsx` and `use-idle-timeout.ts` exist. Wire them together: show a modal
after `IDLE_TIMEOUT_MINUTES` (default 15) of inactivity with a 60 s countdown. On countdown
reaching zero, call `signOut()` and redirect to the landing page. The `extend session` button
resets the idle timer. Ensure the modal is accessible (focus trap, `role="alertdialog"`).

---

### Issue #1075 — Frontend: Cookie consent banner — implement consent gate for analytics
**Layer:** Frontend | **Priority:** Medium

`cookie-consent-banner.tsx` and `cookie-consent.ts` exist. Wire the consent gate: block
`analytics.ts` and `log-shipper.ts` from running until consent is granted. Store consent in
`localStorage` with a version key so new consent categories re-prompt. Add a settings page
entry to revoke consent. Ensure the banner is WCAG 2.1 AA compliant (keyboard navigable,
focus management).

---

### Issue #1076 — Frontend: LocaleSwitcher — complete i18n locale switching
**Layer:** Frontend | **Priority:** Low

`LocaleSwitcher.tsx` exists. Complete the implementation: dropdown of supported locales from
`frontend/src/i18n/routing.ts`, switch locale by navigating to the localized URL, persist
selection in `localStorage`. Announce locale change to screen readers via `aria-live`. Add
a `locale-parity` CI test that all translation keys exist in all locales (the skeleton exists
in `frontend/src/__tests__/locale-parity.test.ts`).

---

### Issue #1077 — Frontend: CommitRevealVote — build complete commit-reveal voting UI
**Layer:** Frontend | **Priority:** Medium

`CommitRevealVote.tsx` and `commitReveal.ts` / `commitRevealStorage.ts` exist. Build the full
two-phase UI:
- Phase 1 (Commit): vote choice selector, random salt generation, hash display, submit commitment tx.
- Phase 2 (Reveal): show stored commitment from `commitRevealStorage`, reveal button builds reveal tx.
- Guard: disable reveal button before reveal window opens.
Add a help tooltip explaining why commit-reveal is used. Follow WCAG 2.1 AA.

---

### Issue #1078 — Frontend: Transaction CSV export — complete export-transactions-csv.ts integration
**Layer:** Frontend | **Priority:** Low

`export-transactions-csv.ts` exists. Wire it to a download button on
`frontend/src/app/transactions/` page. Include columns: Date, Type, Amount, Asset, TxHash,
Status. Handle large result sets by streaming or paginating with a progress indicator. Show
a toast notification when the download is ready. Test with 1,000+ row datasets.

---

### Issue #1079 — Frontend: Draft persistence — persist claim filing form across page refreshes
**Layer:** Frontend | **Priority:** Medium

`use-draft-persistence.ts` exists. Apply it to the claim filing form: auto-save form state
to `localStorage` after every field change (debounced 500 ms). Restore draft on page load with
a `"Restore draft?"` banner. Clear draft on successful submission. Encrypt sensitive fields
(incident description) before storing. Document the encryption approach in a code comment.

---

### Issue #1080 — Frontend: Network status indicator — show Stellar network health in header
**Layer:** Frontend | **Priority:** Low

`use-network-status.ts` exists. Add a small status pill to the global header showing:
🟢 Healthy / 🟡 Degraded / 🔴 Offline. Poll `GET /api/chain/info` and `GET /api/health`
every 30 s. On degraded/offline, show a dismissible banner with a link to the status page
(see `docs/ops/status-page-policy.md`). Respect `prefers-reduced-motion` for status animations.

---

### Issue #1081 — Frontend: Performance budget CI gate — Lighthouse and bundle size checks
**Layer:** Frontend | **Priority:** High

Per `docs/performance-budget.md`, Lighthouse CI is referenced but may not be fully configured.
Add `.lighthouserc.json` with the minimum scores defined in the budget doc. Add a GitHub Actions
job `lighthouse-ci` that runs against the staging deployment on every PR. Fail the build if any
category drops below the minimum. Add `@next/bundle-analyzer` and a bundle size check comparing
against the 180 KB initial JS budget.

---

### Issue #1082 — Frontend: Accessibility audit — WCAG 2.1 AA compliance for claim filing flow
**Layer:** Frontend | **Priority:** High

Per `docs/appeal-accessibility-conformance.md`, the appeal UI has been audited. Apply the same
audit to the full claim filing flow:
1. Run axe-core in the Playwright E2E tests for each step.
2. Fix all violations (focus management, label associations, error announcements).
3. Document findings in a new `docs/claim-filing-accessibility-conformance.md`.
4. Add the page to the automated accessibility CI job.

---

### Issue #1083 — Frontend: Error boundary — improve error pages with actionable recovery
**Layer:** Frontend | **Priority:** Medium

`error-boundary.tsx` and `error-pages.tsx` exist. Improve the error page UX:
1. Show a meaningful title and description per error type (network, auth, contract, unknown).
2. Add a "Try again" button that calls `reset()`.
3. For auth errors, redirect to wallet connect.
4. Log the error to `log-shipper.ts` with stack trace.
5. Add a `route-error.tsx` specific handler for 404 on dynamic routes.

---

### Issue #1084 — Frontend: Landing page — redesign with branding and feature highlights
**Layer:** Frontend | **Priority:** Low

Per `docs/BRANDING.md`, brand guidelines exist. Redesign `frontend/src/components/landing/`
to reflect the brand identity: hero section with animated Stellar blockchain graphic, feature
highlights (on-chain governance, DAO voting, transparent claims), CTA to the quote flow, and
a partners/auditors section. Ensure the landing page meets the ≥85 Lighthouse Performance score.

---

### Issue #1085 — Frontend: Dashboard card order — implement drag-to-reorder dashboard cards
**Layer:** Frontend | **Priority:** Low

`use-dashboard-card-order.ts` exists. Implement drag-and-drop card reordering on the dashboard
using `@dnd-kit/core` (or equivalent). Persist the order in `localStorage`. Add keyboard-accessible
drag controls (space to pick up, arrow keys to move, enter to drop). Announce reordering via
`aria-live`. Add a "Reset order" button in the settings page.

---

## Testing & CI/CD

### Issue #1086 — CI: Add Soroban contract E2E smoke tests against testnet
**Layer:** CI/Contract | **Priority:** High

Add a `.github/workflows/contract-e2e.yml` job that deploys the WASM to Stellar testnet (using a
dedicated test deployer key stored as a GitHub secret) and runs smoke tests: `initialize`,
`initiate_policy`, `file_claim`, `vote_on_claim`, `finalize_claim`. Run on every merge to `main`.
This provides an end-to-end signal that the contract behaves correctly on real Stellar infrastructure.

---

### Issue #1087 — CI: Flaky test report — surface retry counts as PR annotations
**Layer:** CI | **Priority:** Medium

Per `docs/flaky-test-quarantine.md`, `flaky-test-report.yml` parses Jest JSON output for tests with
`invocations > 1`. Verify this job is correctly configured for both `frontend` and `backend` Jest runs.
Add a step that posts flaky test names as PR review annotations (using `actions/github-script`).
Add a failure threshold: if >3 distinct tests are flaky in one PR, fail the job.

---

### Issue #1088 — CI: SDK compatibility job — weekly test against soroban-sdk next-minor
**Layer:** CI/Contract | **Priority:** Medium

Per `docs/sdk-upgrade-checklist.md`, a `test (next-minor)` scheduled CI job should run weekly
against the next SDK minor release. Add `.github/workflows/sdk-compat.yml` with a matrix:
`[pinned (current), next-minor (if available)]`. On failure, open a GitHub issue automatically
using `actions/github-script` and assign the contract owner. This ensures the team gets advance
warning before an SDK upgrade lands as a breaking change.

---

### Issue #1089 — CI: Migration rollback drill — monthly automated smoke test
**Layer:** CI | **Priority:** Medium

Per `docs/ops/migration-rollback-drill.md`, rollback drills are planned. Automate the drill:
add a `.github/workflows/migration-rollback-drill.yml` scheduled monthly job that:
1. Applies the latest migration to a test DB.
2. Runs the backend health check.
3. Rolls back the migration.
4. Asserts the health check still passes.
Post a pass/fail result to the `#ops-alerts` Slack channel.

---

### Issue #1090 — CI: Redis failover drill — automated test for Redis-backed throttler
**Layer:** CI | **Priority:** Medium

Per `docs/ops/redis-failover-drill.md`, Redis failover drills are planned. Add a CI job that:
1. Starts a Redis container.
2. Makes requests to trigger the `RedisThrottlerStorage`.
3. Stops Redis.
4. Asserts the backend degrades gracefully (does not panic, returns 503 or falls back to in-memory).
5. Restarts Redis and confirms normal operation resumes.

---

### Issue #1091 — CI: gitleaks — add pre-commit hook for secret scanning
**Layer:** CI | **Priority:** High

`.gitleaks.toml` exists. Ensure `gitleaks` runs as a Git pre-commit hook via `.githooks/`.
Add `make install-hooks` target to `Makefile` that runs `git config core.hooksPath .githooks`.
Document in `CONTRIBUTING.md` that `make install-hooks` must be run after cloning. Add a CI
check that fails if the hooks directory does not contain a `pre-commit` file named `gitleaks`.

---

### Issue #1092 — CI: Accessibility tests — extend Playwright axe checks to all pages
**Layer:** CI/Frontend | **Priority:** High

The current `accessibility` CI job runs axe checks on a subset of pages. Extend to cover:
quote flow, purchase wizard, claim filing, appeal flow, governance pages, admin pages, and settings.
Fail on any `critical` or `serious` axe violations. Track `moderate` violations as warnings.
Generate an SARIF accessibility report and upload as a CI artifact.

---

### Issue #1093 — CI: Blue-green deployment — smoke test after traffic switch
**Layer:** CI/DevOps | **Priority:** Medium

Per `docs/ops/blue-green-deployment.md`, blue-green deploys are planned. Add a post-deploy smoke
test step that runs after the traffic switch: ping `GET /api/health`, `GET /api/chain/info`, and
`GET /api/claims` and fail the deployment if any returns non-200. Integrate with the `alert-inventory.md`
alert thresholds to automatically roll back if error rate spikes post-deploy.

---

### Issue #1094 — CI: Alert review — quarterly review cadence automation
**Layer:** CI/Ops | **Priority:** Low

Per `docs/ops/alert-review-log.md`, quarterly alert reviews are manual. Add a `.github/workflows/alert-review-reminder.yml`
scheduled job that opens a GitHub issue 2 weeks before each quarter end with a checklist based on
`docs/ops/alert-fatigue-review-process.md`. Assign to the on-call rotation lead. Close the issue
when the `alert-review-log.md` is updated with the new review entry.

---

## Documentation

### Issue #1095 — Docs: API changelog — add initial entries for appeal, dispute, escalation endpoints
**Layer:** Docs | **Priority:** Medium

`docs/api/API_CHANGELOG.md` is referenced in `api-versioning-policy.md` but may not have entries
for the appeal feature (Issue #1360, reviewed 2026-08-28). Add entries for:
- `POST /api/claims/:id/appeal/build-transaction` (added in v1.x)
- `POST /api/claims/:id/appeal` (added in v1.x)
- `POST /admin/claims/:id/finalize-appeal` (added in v1.x)
Per the additive change policy, no MAJOR version bump was required.

---

### Issue #1096 — Docs: STORYBOOK.md — add Storybook setup and component documentation guide
**Layer:** Docs/Frontend | **Priority:** Low

`docs/STORYBOOK.md` exists. Expand it with:
1. How to run Storybook locally (`npm run storybook`).
2. How to write a story for a new component (template + example).
3. Story naming conventions (feature/ComponentName/variant).
4. How the Chromatic CI visual regression step integrates.
5. List of components that currently lack Storybook stories (from a directory scan).

---

### Issue #1097 — Docs: EVENT_DICTIONARY.md — add all missing events from the backlog
**Layer:** Docs/Contract | **Priority:** Medium

`docs/EVENT_DICTIONARY.md` is auto-validated by CI. Add entries for all events introduced in
the backlog issues (#1001–#1025): `vote_dur_updated`, `grace_period_updated`, `proposal_expired`,
`claim_withdrawn`, `region_upserted`, `region_removed`, `reinsurance_triggered`, etc. Each entry
must include: event name, topics array, data fields, emitting entrypoint, and a sample payload.

---

### Issue #1098 — Docs: GLOSSARY.md — add deductible, keeper, and reinsurance definitions
**Layer:** Docs | **Priority:** Low

`docs/GLOSSARY.md` defines Appeal, Dispute, and Escalation. Add definitions for:
- **Deductible** — per-policy amount deducted from approved payout before transfer.
- **Keeper** — permissionless caller that triggers time-based contract transitions.
- **Reinsurance** — fallback payout mechanism from the `ReinsuranceContract` when treasury is insufficient.
- **Rolling Claim Cap** — cumulative payout limit per policy per rolling time window.
- **Voter Snapshot** — the frozen voter registry used for a specific claim round.

---

### Issue #1099 — Docs: CONTRIBUTING.md — add `make install-hooks` step to setup guide
**Layer:** Docs | **Priority:** Low

The gitleaks pre-commit hook (Issue #1091) requires `make install-hooks` to be run after cloning.
Add this as step 2b in `CONTRIBUTING.md` between "clone" and "bootstrap". Also add a note that
`make check-env` should be run before starting any service to catch missing environment variables.
Update the `Prerequisites` table to include the `gitleaks` binary installation instruction.

---

### Issue #1100 — Docs: ops/multi-region-deployment.md — add failover procedure for RPC outage
**Layer:** Docs/Ops | **Priority:** Medium

`docs/ops/multi-region-deployment.md` covers multi-region setup. Add a section:
"Stellar RPC Outage Failover":
1. Detect: Prometheus alert `soroban_rpc_error_rate > 0.1 for 5m`.
2. Switch: update `SOROBAN_RPC_URL` environment variable to the backup RPC provider.
3. Validate: run the `GET /api/chain/info` smoke test.
4. Notify: post to `#incidents` Slack channel.
Include the canonical backup RPC URLs for testnet and mainnet.

---

## Security

### Issue #1101 — Security: Admin rotation — enforce co-signer requirement in admin.rs
**Layer:** Contract/Security | **Priority:** Critical

Directly tracks Issue #1007. Add co-signer enforcement to the multi-step admin rotation flow in
`admin.rs`. The `accept_admin` entrypoint should require a second distinct address to co-sign the
rotation transaction. Update `SECURITY.md` with the new co-signer requirement. Add a penetration
test scenario in `tests/admin_rotation.rs` that asserts a single-signer rotation is rejected.

---

### Issue #1102 — Security: JWT secret rotation — enforce rotation schedule via secrets management
**Layer:** Backend/Security | **Priority:** High

JWT secrets are referenced in `backend/.env.example`. Add them to `docs/ops/.secret-rotation-dates.json`
with a 90-day rotation interval. The secret rotation CI alert (Issue #1064) will then automatically
warn 14 days before expiry. Document the rotation procedure in `docs/ops/secrets-management-runbook.md`:
1. Generate new secret, 2. Deploy with dual-secret validation window, 3. Remove old secret.

---

### Issue #1103 — Security: CSP allowlist — audit and tighten Content Security Policy
**Layer:** Frontend/Security | **Priority:** High

Per `docs/ops/csp-allowlist.md`, the CSP is configured. Audit the current policy:
1. Ensure `script-src` does not include `'unsafe-eval'` or `'unsafe-inline'`.
2. Restrict `connect-src` to known API, IPFS gateway, and Stellar RPC endpoints.
3. Add `require-trusted-types-for 'script'` to prevent DOM XSS via Trusted Types.
4. Add a `Report-To` header pointing to the security reporting endpoint.
Run `npm run build` and verify no CSP violations in browser console.

---

### Issue #1104 — Security: IPFS gateway allowlist — validate evidence URLs against GatewayAllowlist
**Layer:** Contract/Backend/Security | **Priority:** High

The `GatewayAllowlist` storage key exists in the contract. The backend IPFS upload service must
validate that evidence URLs begin with an allowlisted gateway prefix before storing them on-chain.
Add a `IpfsGatewayValidator` service in `backend/src/ipfs/`. Reject URLs that do not match the
allowlist with a 400 error. Update `docs/ops/csp-allowlist.md` to reflect the IPFS gateway entries.

---

### Issue #1105 — Security: Audit exceptions — review and remediate open cargo audit exceptions
**Layer:** Contract/Security | **Priority:** High

`docs/ops/audit-exceptions.md` tracks exceptions to `cargo audit` findings. Review each open
exception: confirm the vulnerability is still marked as an exception, check if a fix has been
released, and upgrade if possible. For each unresolvable exception, document the mitigating control
and schedule the next review date. Add a CI annotation that lists open exceptions on every PR that
touches `Cargo.toml`.

---

### Issue #1106 — Security: Vendor offboarding — automate checklist on team member departure
**Layer:** Ops/Security | **Priority:** Medium

`docs/ops/vendor-offboarding-checklist.md` exists. Add a GitHub Actions workflow
`.github/workflows/offboarding-reminder.yml` triggered manually (`workflow_dispatch`) that opens
a GitHub issue from the offboarding template at `docs/ops/vendor-offboarding-checklist.md`.
Pre-fill the issue with the username and today's date. Assign to the security team label.

---

## Observability & Performance

### Issue #1107 — Observability: Distributed tracing — complete OpenTelemetry setup in tracing.ts
**Layer:** Backend/Ops | **Priority:** Medium

`backend/src/tracing.ts` exists. Ensure the OpenTelemetry tracer is correctly configured with:
1. Span exporter to Jaeger or OTLP endpoint (configurable via `OTEL_EXPORTER_OTLP_ENDPOINT`).
2. Auto-instrumentation for HTTP, PostgreSQL (via Prisma), and Redis.
3. `correlation_id` propagated as a trace attribute.
4. Sampling rate configurable via `OTEL_SAMPLING_RATE` env var (default 0.1 for prod).

---

### Issue #1108 — Observability: Frontend observability — ship client errors to log-shipper
**Layer:** Frontend/Ops | **Priority:** Medium

`frontend/src/lib/log-shipper.ts` and `observability.ts` exist. Wire the `error-boundary.tsx`
to call `logShipper.captureError(error, context)` on every unhandled React error. Add page
performance metrics (LCP, FID, CLS) via the Web Vitals API and ship them to the backend
`POST /api/observability/metrics` endpoint. Rate-limit client-side log shipping to max 10 events/min.

---

### Issue #1109 — Observability: Prometheus alerts — define and document all alert rules
**Layer:** Ops | **Priority:** Medium

Per `docs/performance-budget.md`, Prometheus alerts are referenced at `backend/docs/prometheus-alerts.yml`.
Define alert rules for:
- `indexer_ledger_lag > 100` for 5 minutes → warning
- `indexer_ledger_lag > 300` for 1 minute → critical (PagerDuty)
- `api_p95_latency{route} > budget_ms` for 10 minutes → warning
- `tls_cert_expiry_days < 30` → warning
- `claim_queue_depth > 100` → warning
Document all rules in `docs/ops/alert-inventory.md`.

---

### Issue #1110 — Performance: Indexer throughput — batch ledger processing to reduce DB write contention
**Layer:** Backend/Ops | **Priority:** High

The current indexer processes one ledger close event at a time. Under high chain activity, this
creates DB write contention and increases ledger lag beyond the 3-ledger budget. Implement batch
processing: accumulate up to 10 ledger events before flushing to the DB in a single Prisma
`createMany` transaction. Measure improvement with a load test (see `backend/loadtests/`).

---

### Issue #1111 — Performance: GraphQL query complexity — enforce depth and complexity limits
**Layer:** Backend | **Priority:** Medium

The `GraphqlApiModule` mentions depth/complexity limits. Verify they are enforced with concrete
values. Set `maxDepth: 7` and `maxComplexity: 200` (adjustable via config). Add a test that
a deeply-nested query (depth > 7) returns a GraphQL error. Add a Prometheus metric
`graphql_complexity_rejected_total` counting rejected queries. Document limits in the OpenAPI/GraphQL spec.

---

### Issue #1112 — Performance: Soroban simulation timeout — add per-request timeout and fallback
**Layer:** Backend | **Priority:** Medium

Soroban simulation calls can occasionally hang due to RPC issues. Add a per-request timeout
(`SOROBAN_SIMULATION_TIMEOUT_MS`, default 5000 ms) to all `simulateTransaction` calls in
`backend/src/soroban/`. On timeout, return a structured 503 `ServiceUnavailable` error with
a `Retry-After: 30` header. Log the timeout event with the request correlation ID.

---

## Misc / Cross-Cutting

### Issue #1113 — Tracking: claim lifecycle — full end-to-end cross-stack issue group
**Layer:** All | **Priority:** High

Umbrella tracking issue for the complete claim lifecycle feature work:
- Contract: #1009 (status history log), #1010 (keeper entrypoints), #1023 (withdraw claim)
- Backend: #1031 (policy expiry keeper), #1032 (appeal finalize keeper), #1035 (discussion threads)
- Frontend: #1069 (discussion thread UI), #1073 (TxStatusDialog)

All linked issues should include `feature:claim-lifecycle` label and link back to this umbrella.

---

### Issue #1114 — Tracking: governance — DAO voting and delegation cross-stack group
**Layer:** All | **Priority:** Medium

Umbrella tracking issue for governance feature work:
- Contract: #1013 (proposal expiry), #1016 (rolling claim cap), #1006 (voter snapshot TTL)
- Backend: #1036 (delegation endpoints), #1037 (GraphQL escalation mutation)
- Frontend: #1068 (delegation UI), #1065 (admin voter registration)

All linked issues should include `feature:governance` label and link back to this umbrella.

---

### Issue #1115 — Tracking: oracle integration — price feed and fraud scoring cross-stack group
**Layer:** All | **Priority:** High

Umbrella tracking issue for oracle integration:
- Contract: #1017 (sign-then-verify oracle), #1019 (vet specialization validation)
- Backend: #1046 (Prometheus treasury gauge from oracle data)
- Frontend: #1080 (network status indicator, oracle feed display)

All linked issues should include `feature:oracle` label and link back to this umbrella.

---

### Issue #1116 — Naming conventions audit — fix camelCase/snake_case drift in existing API responses
**Layer:** Backend/Frontend | **Priority:** Medium

Per `docs/NAMING_CONVENTIONS.md`, an audit of naming drift was deferred. Conduct the audit:
1. Sample 20 API response fields from the OpenAPI spec.
2. Compare against the DB column names and contract event field names.
3. File individual follow-up issues for any `value`/`sum`/`amount` drift, or `holder`/`owner`/`address` synonym confusion.
4. Document findings in `docs/NAMING_CONVENTIONS.md` under an "Audit Results" section.

---

### Issue #1117 — Event dictionary — CI validation script for all new events
**Layer:** CI/Docs | **Priority:** Medium

`docs/EVENT_DICTIONARY.md` is stated to be auto-validated by CI, but the validation script may
not cover all formats. Extend the validator to:
1. Parse the dictionary for all event entries.
2. Cross-reference against `contracts/niffyinsure/src/events.rs` to verify every `#[contractevent]`
   struct has a corresponding dictionary entry.
3. Fail CI with a diff if any event is undocumented.

---

### Issue #1118 — Soroban toolchain policy — document upgrade path for stellar-cli
**Layer:** Docs/Contract | **Priority:** Low

`docs/soroban-toolchain-policy.md` covers `soroban-sdk` versioning. Add a section for `stellar-cli`
(Soroban CLI) version pinning: document the current pinned version in `CONTRIBUTING.md`, the
compatible range, and the upgrade procedure (analogous to the SDK checklist in `docs/sdk-upgrade-checklist.md`).
Add the CLI version to the `Makefile` as a checked prerequisite.

---

### Issue #1119 — Staging data refresh — implement anonymized production data snapshot
**Layer:** Backend/Ops | **Priority:** Medium

Per `docs/ops/staging-data-refresh-job.md`, a staging refresh job is planned. Implement:
1. A cron job that runs weekly in production, exports a snapshot of recent claims/policies.
2. Anonymizes all PII (wallet addresses hashed, display names replaced with UUIDs).
3. Imports the snapshot into the staging DB.
4. Runs `backend/src/scripts/` migration scripts to ensure the staging schema is current.
Gate the job behind a `STAGING_REFRESH_ENABLED` environment variable.

---

### Issue #1120 — Disaster recovery — complete annual DR drill and document results
**Layer:** Ops | **Priority:** High

Per `docs/ops/disaster-recovery-runbook.md`, an annual DR drill is required. Document the process:
1. Restore a PostgreSQL backup to a fresh instance.
2. Verify all migrations apply cleanly.
3. Run the backend health check.
4. Confirm the indexer re-syncs from the checkpoint ledger.
5. Verify all secrets are accessible from the vault.
Record the drill result in `docs/ops/recovery-drill-log.md` using the template in
`docs/ops/recovery-drill-ticket-template.md`.

---

### Issue #1121 — Tracking: ramp and fiat integration cross-stack group
**Layer:** All | **Priority:** Medium

Umbrella tracking issue for fiat on/off-ramp integration:
- Backend: #1049 (RampModule implementation)
- Frontend: `frontend/src/components/ramp/` (Ramp UI)
- Contract: N/A (fiat ramps are off-chain)

All linked issues should include `feature:ramp` label and link back to this umbrella.

---

### Issue #1122 — i18n: Add missing translation keys for appeal and governance flows
**Layer:** Frontend | **Priority:** Medium

The `locale-parity.test.ts` CI test asserts all translation keys exist in all locales. Run the test
and identify any missing keys introduced by the appeal flow (appeal confirmation, appeal result toast,
appeal voter snapshot labels). Add the missing keys to all locale files in `frontend/src/i18n/`.
Ensure pluralization rules are correct (see `frontend/src/__tests__/plurals.test.ts`).

---

### Issue #1123 — Dependency update — review and merge open Dependabot PRs
**Layer:** All | **Priority:** Medium

Per `docs/dependency-update-process.md`, Dependabot PRs for critical dependencies require a
specific review process. Assign an owner to review all currently open Dependabot PRs, prioritizing:
1. Security patches (any severity).
2. `soroban-sdk` patch versions (must follow `docs/sdk-upgrade-checklist.md`).
3. `next` and `nestjs/core` minor bumps.
Merge all non-breaking updates within 2 weeks of opening.

---

### Issue #1124 — Blue-green deployment — document rollback procedure for failed contract upgrades
**Layer:** Ops/Contract | **Priority:** High

Per `docs/ops/blue-green-deployment.md`, contract upgrades are a special case because WASM
upgrades are irreversible once applied. Document:
1. Pre-upgrade: snapshot treasury balance and all open claim IDs.
2. During: deploy to testnet, run smoke tests, then apply to mainnet.
3. Post-upgrade: verify `get_contract_version()` returns expected values.
4. Rollback: if the new WASM is broken, the only path is a hotfix WASM re-deploy — document steps.
Add this to `docs/ops/disaster-recovery-runbook.md`.

---

### Issue #1125 — Tracking: full platform launch readiness checklist
**Layer:** All | **Priority:** Critical

Umbrella tracking issue for all mainnet launch readiness items. Must be resolved before
`STELLAR_NETWORK=mainnet` deployment:

**Contract:**
- [ ] #1007 Multi-sig admin for treasury sweeps
- [ ] #1014 Event replay protection (nonce enforcement)
- [ ] #1017 Oracle sign-then-verify pipeline
- [ ] #1101 Admin rotation co-signer enforcement

**Backend:**
- [ ] #1039 Multi-tenant query isolation audit
- [ ] #1053 Chain module network passphrase validation
- [ ] #1060 Per-wallet rate limits for claim filing
- [ ] #1061 Webhook SSRF periodic re-validation
- [ ] #1063 GDPR right-to-erasure implementation
- [ ] #1102 JWT secret rotation schedule

**Frontend:**
- [ ] #1075 Cookie consent gate for analytics
- [ ] #1081 Performance budget CI gate
- [ ] #1082 Claim filing accessibility audit
- [ ] #1103 CSP allowlist audit and tighten

**Ops:**
- [ ] #1086 Contract E2E smoke tests on testnet
- [ ] #1091 gitleaks pre-commit hook installed
- [ ] #1104 IPFS gateway allowlist enforcement
- [ ] #1105 Cargo audit exceptions reviewed
- [ ] #1120 DR drill completed and documented
- [ ] #1124 Contract upgrade rollback procedure documented

All issues above must be closed before the mainnet launch date. Assign to the launch milestone.
