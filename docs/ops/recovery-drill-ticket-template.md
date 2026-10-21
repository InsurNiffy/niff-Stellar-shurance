# Recovery Drill Ticket Template

Use this template in your internal wiki, incident tool, or ticketing system for every quarterly restore drill, annual DR drill, and every real recovery event.

## Metadata

- Drill type: Annual Full DR Drill / Quarterly Restore Drill
- Environment:
- Date:
- Incident commander:
- Backend responder:
- DBA/Ops responder:
- Backup object key:
- Restore database target:
- Replay anchor ledger `N`:

## Timing

- Restore started at:
- Restore completed at:
- Replay started at:
- Replay completed at:
- Observed RPO (Target: <= 6 hours):
- Observed RTO (Target: <= 2 hours):

## Validation

### 1. PostgreSQL Restore
- `policies` row count:
- `claims` row count:
- `raw_events` row count:
- Restored `ledger_cursors` values:
- Schema tables validated (`policies`, `claims`, `votes`, `raw_events`, `ledger_cursors`, `admin_audit_logs`):

### 2. Database Migrations
- Migration status (`npx prisma migrate status`):
- All pending migrations applied cleanly: yes/no
- Schema drift detected: none / details

### 3. Backend Health Check
- Health check status (`GET /health`): HTTP 200 OK / other
- Probes status (`db`, `redis`, `rpc`, `horizon`, `indexer`):

### 4. Indexer Re-sync from Checkpoint Ledger
- Checkpoint anchor ledger `N`:
- Replay reached current ledger window: yes/no
- Events re-indexed without duplicates: yes/no
- `ledger_cursors.last_processed_ledger` updated:

### 5. Vault Secrets Accessibility
- Secret inventory audited against Vault / Secrets Manager:
- All required secrets accessible and valid: yes/no
- Inaccessible or expired keys: none / details

## Findings

- What worked:
- What was slow or manual:
- Any access, IAM, or secret issues:
- Any replay/data-consistency issues:

## Follow-up actions

- Owner:
- Due date:
- Linked PRs/issues:
