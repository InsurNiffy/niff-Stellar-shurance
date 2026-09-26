# Database Migration Rollback Drill

## Overview

This document describes a scheduled drill to verify that the most recent Prisma database migration can be safely rolled back. This ensures that if a production deployment needs to be reverted, we can do so without data loss or corruption.

## Drill Frequency

- **Scheduled**: Per release (before each production release) and weekly in non-production environments
- **Run Time**: Off-peak hours (2-4 AM UTC)
- **Environment**: Staging/test environment only (never production)

## Pre-Drill Checklist

- [ ] Test database is available and has recent production data
- [ ] Backup of test database created
- [ ] On-call engineer available if issues are found
- [ ] Monitoring systems ready to capture any issues
- [ ] Alerts configured to notify team on drill failure

## Drill Steps

### Phase 1: Setup

1. **Create disposable copy of database**
   ```bash
   # Use production backup (encrypted, sanitized)
   psql -U postgres -d template1 -c "CREATE DATABASE test_migration_rollback FROM prod_backup;"
   
   # Verify data integrity
   psql -U postgres -d test_migration_rollback -c "SELECT COUNT(*) FROM users;"
   ```

2. **Record starting state**
   ```bash
   # Get list of migrations already applied
   npm run prisma:migrate:status -- --skip-generate > /tmp/migration_status_before.txt
   
   # Get schema hash
   npm run prisma:generate
   shasum -a 256 prisma/schema.prisma > /tmp/schema_hash_before.txt
   ```

### Phase 2: Apply Latest Migration

1. **Apply the latest migration to test database**
   ```bash
   DATABASE_URL="postgresql://user:pass@localhost/test_migration_rollback" \
   npm run prisma:migrate:deploy
   ```

2. **Verify migration succeeded**
   ```bash
   DATABASE_URL="postgresql://user:pass@localhost/test_migration_rollback" \
   npm run prisma:migrate:status
   
   # Check for any errors in logs
   tail -n 50 /var/log/postgresql/postgresql.log | grep -i error
   ```

3. **Record post-migration state**
   ```bash
   # Get list of migrations
   npm run prisma:migrate:status -- --skip-generate > /tmp/migration_status_after.txt
   
   # Get data counts for verification
   DATABASE_URL="postgresql://user:pass@localhost/test_migration_rollback" \
   npm run scripts/verify-data-integrity.js
   ```

### Phase 3: Rollback Migration

1. **Execute rollback**
   ```bash
   DATABASE_URL="postgresql://user:pass@localhost/test_migration_rollback" \
   npm run prisma:migrate:resolve -- --rolled-back <migration_name>
   ```

2. **Verify rollback succeeded**
   ```bash
   DATABASE_URL="postgresql://user:pass@localhost/test_migration_rollback" \
   npm run prisma:migrate:status
   
   # Verify schema reverted
   npm run prisma:generate
   shasum -a 256 prisma/schema.prisma > /tmp/schema_hash_rollback.txt
   
   # Verify data integrity after rollback
   npm run scripts/verify-data-integrity.js
   ```

3. **Compare with baseline**
   ```bash
   # Compare migration status
   diff /tmp/migration_status_before.txt /tmp/migration_status_after_rollback.txt
   
   # Verify no data loss (row counts should match)
   diff /tmp/data_counts_before.txt /tmp/data_counts_after_rollback.txt
   ```

### Phase 4: Verification

1. **Data Integrity Checks**
   - [ ] No missing tables
   - [ ] All columns present with correct types
   - [ ] Row counts match baseline
   - [ ] No orphaned foreign key constraints
   - [ ] Indexes still exist and are valid

2. **Schema Verification**
   - [ ] Prisma schema compiles without errors
   - [ ] Schema hash matches expected value
   - [ ] All client generations succeed

3. **Performance Verification**
   - [ ] Query performance acceptable (compare plan before/after)
   - [ ] No missing indexes causing slow queries
   - [ ] No dead connections or locks

## Success Criteria

Drill is **SUCCESSFUL** if:
- ✓ Migration applied without errors
- ✓ Migration rolled back without errors
- ✓ All data integrity checks pass
- ✓ Schema verification succeeds
- ✓ No data loss detected
- ✓ Performance acceptable post-rollback

Drill is **FAILED** if:
- ✗ Migration fails to apply or roll back
- ✗ Data loss detected after rollback
- ✗ Data integrity violations found
- ✗ Schema verification fails
- ✗ Performance degradation observed

## Handling Failures

If the drill fails:

1. **Immediate Action**
   - Alert on-call engineer
   - Pause deployment until root cause identified
   - Preserve test database for analysis

2. **Investigation**
   - Collect full logs from migration execution
   - Analyze schema differences
   - Identify specific table/column causing issue
   - Determine if issue is migration code or data-related

3. **Follow-up**
   - File critical issue: "Migration rollback failure: [description]"
   - Assign to database/migration owner
   - Include reproduction steps and logs
   - Include analysis of impact and options for fixing

4. **Escalation**
   - If production rollback capability is impaired, escalate to engineering leadership
   - Schedule emergency review of migration strategy
   - Consider deployment freeze until resolved

## Production Rollback Procedure

If production deployment needs to be reverted (based on drill findings):

1. **Alert team**
   ```bash
   # Send notification to on-call, team chat
   echo "ROLLBACK INITIATED: [reason]" | notify-team
   ```

2. **Prepare rollback**
   ```bash
   # Take backup before attempting rollback
   pg_dump -Fc prod_db > /backups/pre_rollback_$(date +%Y%m%d_%H%M%S).dump
   ```

3. **Execute rollback** (using exact same steps as drill)
   ```bash
   npm run prisma:migrate:resolve -- --rolled-back <migration_name>
   ```

4. **Verify rollback**
   - Run post-rollback data integrity checks
   - Verify application functionality
   - Check monitoring for anomalies
   - Confirm users can access their accounts

5. **Post-Incident**
   - Document what went wrong
   - File follow-up issue for fix
   - Schedule incident review meeting

## Related Documents

- [Database Backup and Recovery Strategy](../database-backup.md)
- [Deployment Procedure](./blue-green-deployment.md)
- [Incident Response Playbook](../incidents.md)
- [Data Integrity Verification Scripts](../../scripts/db-verify/)
