# Privacy & data retention runbook

This document complements `maintenance-runbook.md` and the in-app privacy policy. It records **why** we retain soft-deleted indexer data, **how long** it lives, and the **legal framing** for operators.

## Soft delete (policies, claims, votes)

### Behaviour

- **Public / tenant APIs** only return rows where `deleted_at` IS NULL on the materialized tables (`policies`, `claims`, `votes`).
- **Admin** may list policies with `GET /admin/policies?include_deleted=true` to include soft-deleted rows for compliance and support.
- **Logical delete** is performed via `DELETE /admin/policies/:holder/:policyId` (Nest route: holder + numeric policy id). This sets `deleted_at` on the policy, all claims for that policy, and all votes on those claims.
- **`raw_events` is never modified** by soft delete. The append-only event log remains the canonical source for **reindex** and forensic replay; soft delete affects only derived materialization.

### Legal / compliance basis (summary)

- **Insurance and fraud investigations** may require access to historical policy and claim context for a defined period after logical removal from customer-facing surfaces.
- **Soft delete** implements **data minimisation** in product (users no longer see removed data) while retaining **integrity** of audit and reindex pipelines.
- **Hard delete** after the retention window supports **storage limitation**, consistent with documented retention schedules, subject to jurisdiction-specific holds or litigation preservation notices (which supersede automated purge — operators must pause or adjust jobs when served).

Operators should align `DATA_RETENTION_DAYS` with counsel-approved schedules; default in code is **730 days** unless overridden by environment.

## Scheduled purge (`DATA_RETENTION_DAYS`)

- **Job:** `DataRetentionService` runs daily (cron). It **hard-deletes** materialized rows where `deleted_at` is set and **older than** `DATA_RETENTION_DAYS` from the run time.
- **Order:** votes → claims → policies (FK-safe).
- **Idempotent:** Re-running the same window removes no additional rows.
- **Concurrency:** Safe alongside live ingestion: only rows with non-null `deleted_at <= cutoff` are removed; new rows have `deleted_at` NULL.

## Appeal records

Appeals have **no separate retention period**. There is no appeal table: every
piece of appeal state is a column on, or a cascading relation of, the `claims`
row it belongs to, so appeal records are retained for exactly as long as the
claim they belong to and are purged in the same transaction.

### What counts as an appeal record

| Data | Where it lives | Purged by |
|---|---|---|
| Appeal count + submission tx hash | `claims.appeals_count`, `claims.appeal_tx_hash` | Claim row purge |
| Resolution outcome | `claims.status` (`UNDER_APPEAL` → `APPROVED` / `REJECTED`) | Claim row purge |
| Appeal-round vote tallies | `votes` rows for the claim (`@@unique([claimId, voterAddress])` — an appeal vote reuses the voter's row for that claim) | Claim row purge (votes deleted first, FK order) |
| Evidence referenced during the original claim | `claims.image_urls`, `evidence_metadata` (`onDelete: Cascade`) | Claim row purge (cascade) |
| Claimant/voter discussion on the claim | `claim_comments` (`onDelete: Cascade`) | Claim row purge (cascade) |

### Retention period

**Same as the general claims retention policy — `DATA_RETENTION_DAYS` (default
730 days) measured from `deleted_at`**, per [Scheduled purge](#scheduled-purge-data_retention_days)
above. An appeal record is visible on customer-facing surfaces until the claim
is soft-deleted, then hard-deleted with it once the window elapses. Nothing in
the purge job is appeal-aware, and nothing needs to be: `votes → claims →
policies` already removes the tallies, and the `evidence_metadata` /
`claim_comments` cascades remove the rest.

This is deliberate. An appeal is a second round of review on the *same* claim,
not a new dispute record — the fraud-investigation and audit-integrity
justifications in [Legal / compliance basis](#legal--compliance-basis-summary)
apply to the appeal outcome for the same reasons and over the same horizon they
apply to the original decision. Splitting the two would leave a claim whose
rejection is retained but whose reversal is not, which is worse for both audit
and the claimant.

### Where appeal-related data differs from the claim window

Three surfaces intentionally diverge, none of which is the appeal record itself:

- **`raw_events` — shorter (`INDEXER_RETENTION_DAYS`, default 90 days).** The
  `AppealOpened` / `appeal_approved` / `appeal_rejected` events are pruned by
  `ledgerClosedAt`, well before the claim row. Safe because these events are
  replayable from chain; the materialized outcome on the claim row is the
  retained copy.
- **`admin_audit_log` — longer (indefinite, append-only).** An admin
  force-finalize (`POST /admin/claims/:id/finalize-appeal`) writes an audit row
  that is never updated or deleted, so the operator action survives the claim
  purge. It records the actor and claim id, not appeal content.
- **On-chain appeal state — permanent, not deletable.** `open_appeal` /
  `vote_on_appeal` / `finalize_appeal` write to contract persistent storage with
  TTL extension and remain readable via `get_claim` indefinitely. Erasure and
  purge cover off-chain rows only; this is the same limitation already recorded
  for claims under [PII Fields Erased/Anonymized](#pii-fields-erasedanonymized).

### Right-to-erasure interaction

No appeal-specific handling is required. Free-text a claimant supplies is in
`claims.description` / `claims.image_urls`, which the erasure path already
redacts; `appeals_count` and `appeal_tx_hash` are a counter and a public ledger
identifier, not PII.

## Right-to-erasure (GDPR Article 17)

### Process

1. **Request Submission:** Admin submits erasure request via `POST /admin/privacy/requests` with subject wallet address, request type (ANONYMIZE or DELETE), and notes.
2. **Immediate Execution:** The request is processed synchronously, erasing or anonymizing PII fields in off-chain DB rows.
3. **Audit Logging:** All erasure requests are logged in `privacy_requests` table and admin audit log, including actor and timestamp.
4. **Response:** Returns request ID and rows affected count.
5. **Verification:** Admin can list requests via `GET /admin/privacy/requests` to track status.

### PII Fields Erased/Anonymized

- **Claims:** `description` → '[redacted]', `imageUrls` → []
- **Audit Logs:** Actor field anonymized for erased users (preserves integrity but removes PII)
- **On-chain data:** Immutable, not erased (documented in service comments)

### SLA

- **Processing Time:** Immediate (synchronous execution)
- **Completion Notification:** Via API response
- **Audit Retention:** Erasure requests logged indefinitely for compliance
- **Escalation:** If request fails, error logged and status set to FAILED

## Environment

| Variable               | Purpose                                      |
|------------------------|----------------------------------------------|
| `DATA_RETENTION_DAYS`  | Days after `deleted_at` before hard-delete   |
| `INDEXER_RETENTION_DAYS` | Days of `raw_events` / `ledger_cursors` history kept |

## Related code

- `backend/prisma/schema.prisma` — `deletedAt` on `Policy`, `Claim`, `Vote`;
  appeal fields (`appealsCount`, `appealTxHash`) and the cascading
  `EvidenceMetadata` / `ClaimComment` relations on `Claim`
- `backend/src/admin/admin-policies.service.ts` — list + soft delete
- `backend/src/maintenance/data-retention.service.ts` — purge job
- `backend/src/claims/claims.service.ts` — public API filters
- `backend/src/maintenance/privacy.service.ts` — erasure implementation
- `backend/src/admin/admin.controller.ts` — API endpoints
