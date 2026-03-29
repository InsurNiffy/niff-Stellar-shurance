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

## Environment

| Variable               | Purpose                                      |
|------------------------|----------------------------------------------|
| `DATA_RETENTION_DAYS`  | Days after `deleted_at` before hard-delete   |

## Related code

- `backend/prisma/schema.prisma` — `deletedAt` on `Policy`, `Claim`, `Vote`
- `backend/src/admin/admin-policies.service.ts` — list + soft delete
- `backend/src/maintenance/data-retention.service.ts` — purge job
- `backend/src/claims/claims.service.ts` — public API filters
