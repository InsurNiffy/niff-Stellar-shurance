# Staging Data Sync Job: Refresh Schedule & Operations

**Status**: Currently DISABLED pending compliance review of field-by-field anonymization rules.

## Overview

The staging data sync job periodically copies a representative, anonymized subset of production data into the staging environment. This allows QA, testing, and development work on realistic data without exposing real personally identifying information (PII), health records, financial details, or other sensitive fields.

The job:
- Samples recent claims, policies, profiles, and support records (not a full production snapshot)
- Applies deterministic, field-level anonymization transforms (see `backend/src/staging/ANONYMIZATION_RULES.md`)
- Preserves referential integrity within the synced dataset (e.g., claims still reference their policies, via anonymized tokens)
- Drops or redacts sensitive free-text fields (e.g., claim descriptions, support messages)
- **Does NOT sync audit logs, privacy request records, or other compliance/operational tables**

---

## Enabling the Job

**Do NOT enable this job without prior compliance review.**

Before enabling:

1. **Read** `backend/src/staging/ANONYMIZATION_RULES.md` in full.
2. **Verify** that every table and field in the production schema is listed and classified.
3. **Have a person with authority over data privacy/compliance for this product review and sign off** on the field classifications. This must include verification that:
   - No sensitive health, financial, or personal identification data is being copied.
   - All free-text fields that could leak PII are properly redacted.
   - Wallet addresses and other long-lived identifiers are properly anonymized.
4. **Only after sign-off**: Set the environment variable `STAGING_DATA_SYNC_ENABLED=true` to enable job scheduling.

If any of these steps are skipped or incomplete, do not enable the job. The cost of a missed sensitive column is a real compliance and security incident.

---

## Configuration

### Environment Variables

| Variable | Default | Required | Description |
|---|---|---|---|
| `STAGING_DATA_SYNC_ENABLED` | `false` | Yes (to enable) | Set to `true` to enable automatic scheduling. Job remains disabled until this is set. |
| `STAGING_DATA_SYNC_CRON` | `0 2 * * *` | No | Cron pattern for job schedule (default: 02:00 UTC daily). Format: minute hour day month weekday. |
| `STAGING_DB_URL` | (from env) | Yes (to write results) | Connection string for staging database. Must be different from `DATABASE_URL` (production). |

### Refresh Schedule

**Default**: Daily at **02:00 UTC**

The default cron pattern `0 2 * * *` means:
- Minute: 0
- Hour: 2 (02:00 UTC = 21:00 EST / 18:00 PST)
- Day: * (every day)
- Month: * (every month)
- Weekday: * (every day of week)

**To customize**:
```bash
export STAGING_DATA_SYNC_CRON="0 3 * * 0"  # Every Sunday at 03:00 UTC
export STAGING_DATA_SYNC_CRON="0 */6 * * *"  # Every 6 hours
```

---

## Operations

### Dry-Run (Safe, Read-Only)

The dry-run mode queries production data and reports what WOULD be synced, without actually writing anything. This is useful for:
- Verifying job scope before first production run
- Auditing data volumes
- Testing without touching production or staging

**Trigger manually**:
```bash
# Via admin API (if exposed):
curl -X POST http://localhost:3000/admin/staging-sync/dry-run

# Or directly in code:
const job = await stagingDataSyncJob.triggerDryRun();
```

**Output**: JSON report of tables and row counts
```json
{
  "tablesProcessed": ["claims", "policies", "votes", ...],
  "rowsPerTable": {
    "claims": 1000,
    "policies": 245,
    "votes": 3421,
    ...
  },
  "totalRows": 12345,
  "samplingStrategy": "representative_sample: 1000 recent claims + related policies/votes/comments",
  "drySyntax": true,
  "timestamp": "2026-08-28T02:00:00.000Z"
}
```

### Full Sync (Writes to Staging)

Runs the anonymization pipeline and writes anonymized data to staging database.

**Requirements**:
- `STAGING_DATA_SYNC_ENABLED=true`
- Compliance review completed
- `STAGING_DB_URL` configured and pointing to actual staging database

**Trigger manually** (after compliance review):
```bash
# Via admin API (if exposed):
curl -X POST http://localhost:3000/admin/staging-sync/run

# Or directly in code:
const job = await stagingDataSyncJob.triggerSync();
```

**Returns**: Same statistics report as dry-run, but with `drySyntax: false` and data actually written to staging.

### Automatic Scheduling

Once enabled, the job runs automatically on the configured cron schedule. Monitor job status in Redis/BullMQ queue.

---

## Data Sampling Strategy

The sync job samples data selectively rather than copying the entire production database:

| Table | Sample Size | Selection Strategy |
|---|---|---|
| `claims` | 1000 most recent | ORDER BY createdAt DESC LIMIT 1000 |
| `policies` | All related to sampled claims | Foreign key join to sampled claims |
| `votes` | All for sampled claims | Where claimId in sampled claim IDs |
| `holder_profiles` | 500 most recent active profiles | ORDER BY createdAt DESC LIMIT 500 |
| `support_tickets` | 500 most recent | ORDER BY createdAt DESC LIMIT 500 |
| `support_ticket_replies` | 1000 most recent | ORDER BY createdAt DESC LIMIT 1000 |
| `notifications` | 1000 most recent | ORDER BY createdAt DESC LIMIT 1000 |
| `notification_preferences` | All (small table) | SELECT * |
| `ramp_transactions` | 1000 most recent | ORDER BY createdAt DESC LIMIT 1000 |
| `claim_comments` | 1000 most recent | ORDER BY createdAt DESC LIMIT 1000 |
| `evidence_metadata` | 1000 most recent | ORDER BY createdAt DESC LIMIT 1000 |
| `registered_voters` | All (small table) | SELECT * |
| `posts` | 1000 most recent | ORDER BY createdAt DESC LIMIT 1000 |

**Rationale**: Using recent data gives you a realistic staging dataset for functional testing without overwhelming the staging database with 100% of production volume.

---

## What Gets Dropped or Anonymized

### Completely Dropped (Not Synced)
- `admin_audit_logs` — admin operation audit trail
- `tenant_config_audit_logs` — tenant configuration audit trail
- `privacy_requests` — privacy request submissions and status
- `profile_audit_logs` — field-level profile change history
- Free-text fields: `claim.description`, `claim_comment.body`, `support_ticket.subject`, `support_ticket.message`, `support_ticket_reply.message`, `post.title`, `post.body`, `evidence_metadata.cid`, `evidence_metadata.url`
- Transaction details: `txHash`, `eventIndex`, `finalTxHash`, `appealTxHash` on any table

### Anonymized (Replaced with Synthetic/Tokenized Data)
- **Wallet addresses**: Replaced with deterministic Stellar-format synthetic addresses (e.g., `G...`). Same real wallet always maps to same synthetic wallet within a sync run.
- **Email addresses**: Replaced with synthetic addresses (e.g., `user_<hash>@staging.example.com`)
- **Display names**: Replaced with generic tokens (e.g., `User_<hash>`)
- **Foreign key IDs**: Replaced with consistent tokens (e.g., `tok_<hash>`) to preserve referential integrity

---

## Anonymization Consistency

All anonymization is **deterministic**: the same real value always produces the same synthetic value within a single sync context. This means:
- A wallet address that appears in multiple rows (e.g., multiple claims from the same holder) is anonymized to the same synthetic address in all rows.
- Foreign keys remain consistent (a claim's anonymized policyId always references the same anonymized policy in the synced dataset).
- Subsequent sync runs can reuse the same anonymization mappings (if desired by maintainers).

---

## Monitoring & Troubleshooting

### Logs

The job logs to the standard application logger with prefix `[staging-data-sync]` and `[staging-data-sync-job]`.

**Expected log pattern**:
```
[staging-data-sync] Starting dry-run...
  claims: 1000 rows (out of 50000 total)
  policies: 245 rows (related to sample claims)
  ...
[staging-data-sync] Dry-run complete. Total rows to sync: 12345
```

### Errors

If the job fails:
1. Check Redis connectivity and BullMQ queue status.
2. Check production database connectivity (for read operations).
3. Check staging database connectivity (for write operations, full sync only).
4. Review logs for field/schema mismatches (e.g., if schema has changed since ANONYMIZATION_RULES.md was written).

### Job Status

Query BullMQ directly or via admin dashboard to check:
- Last successful run timestamp
- Next scheduled run time
- Recent error messages
- Job queue length

---

## Safety Guardrails

1. **Disabled by default**: Job does not run unless `STAGING_DATA_SYNC_ENABLED=true` is explicitly set.
2. **Dry-run available**: Always test with dry-run before full sync.
3. **Separate staging DB**: Writes only to a separate staging database, never production.
4. **No real PII in staging**: Field-by-field anonymization removes all personally identifying and sensitive data.
5. **Audit trail**: All manual triggers and scheduled runs are logged.
6. **Compliance review required**: Job must not be enabled without sign-off from a person with privacy/compliance authority.

---

## Compliance Review Checklist

Before enabling, confirm:

- [ ] ANONYMIZATION_RULES.md has been read in full
- [ ] Every table and field in production schema is listed and classified
- [ ] Free-text fields containing unstructured PII (descriptions, messages, comments, etc.) are dropped
- [ ] Wallet addresses and persistent identifiers are anonymized
- [ ] Email addresses and personal names are anonymized
- [ ] Audit/operational tables (admin_audit_logs, privacy_requests, etc.) are excluded
- [ ] Transaction hashes and on-chain references are dropped
- [ ] A compliance/privacy authority has reviewed the field list and approved the classification
- [ ] `STAGING_DATA_SYNC_ENABLED=true` will only be set after all above are complete

---

## FAQ

**Q: Can we sync the entire production database?**
A: By design, the job samples recent data rather than copying 100% of production. This keeps staging database size manageable and sampling is sufficient for realistic functional testing. Full copies can be added later if needed (with separate review).

**Q: What if new fields are added to production?**
A: ANONYMIZATION_RULES.md must be updated to classify the new field before the job runs again. An automated schema-diff check could be added to the job to flag new columns and pause until reviewed.

**Q: Can we audit what got anonymized?**
A: Yes. The job logs row counts per table and anonymization statistics. A post-sync audit script could verify (in staging) that sensitive fields are truly empty/redacted. (Note: cannot compare real values to staged values without exposing real data in the log.)

**Q: Is anonymization reversible?**
A: No. Anonymization is deterministic but one-way. Once production data is copied to staging in anonymized form, you cannot recover the real wallet addresses, emails, etc. from the staging dataset. This is intentional.

**Q: Why is there a separate staging database and not just staging views/schemas in production?**
A: This design isolates staging from production entirely, minimizing blast radius if someone accidentally runs a query against the wrong connection string. Separate databases are the gold standard for this separation.

---

## Support

For questions or issues:
1. Check this document and ANONYMIZATION_RULES.md.
2. Review logs with prefix `[staging-data-sync]`.
3. Run dry-run to verify connectivity and scope.
4. Contact the maintainer who approved the compliance review.
