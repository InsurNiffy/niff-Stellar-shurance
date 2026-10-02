# Database Migration Rollback Procedure

This document outlines the procedure for rolling back database migrations in the NiffyInsure backend system.

## CI Migration Dry-Run

Every pull request that touches `backend/**` triggers the **`migration-diff`** CI job. This job:

1. **Spins up a shadow Postgres database** and applies all existing migrations via `prisma migrate deploy`.
2. **Runs `prisma migrate diff`** to compute the SQL that would be generated for any pending schema changes:
   ```bash
   npx prisma migrate diff \
     --from-local-db \
     --to-schema-datamodel prisma/schema.prisma \
     --script
   ```
3. **Uploads `migration-diff.sql`** as a CI artifact (retained 30 days) so reviewers can inspect it without running anything locally.
4. **Fails the job if destructive statements are detected** — specifically any `DROP TABLE`, `DROP COLUMN`, `DROP INDEX`, `DROP CONSTRAINT`, or `ALTER TABLE … ALTER COLUMN` that could cause data loss.

### Bypass label

If a destructive migration is intentional (e.g., removing a deprecated column after a data-migration release), add the **`migration-bypass-destructive`** label to the PR before CI runs (or re-run the job after adding it). This label:

- Requires a second reviewer to approve before merging.
- Must be removed again after the PR merges.
- **Never use for unplanned or unreviewed drops.**

### Reviewing the diff artifact

1. Open the PR's **Checks** tab and find the `migration-diff` job.
2. Download **`migration-diff-<sha>.zip`** from the job's artifact panel.
3. Open `migration-diff.sql` and confirm the SQL is safe (no unintended drops, no column-type coercions that truncate data).
4. If anything looks wrong, push a schema fix **before** requesting review.

### Running the diff locally

```bash
# Start a local Postgres instance (or point DATABASE_URL at your dev DB)
export DATABASE_URL="postgresql://prisma:prisma@localhost:5432/niffyinsure_diff"

# Apply existing migrations
npx prisma migrate deploy

# Generate the diff
npx prisma migrate diff \
  --from-local-db \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

## Prerequisites

- Access to the production database
- Prisma CLI installed locally
- Database backup before any rollback operation
- Admin privileges

## Rollback Scenarios

### 1. Single Migration Rollback

Use this when you need to rollback the most recent migration:

```bash
# Navigate to backend directory
cd backend

# Set database URL
export DATABASE_URL="your-production-database-url"

# Rollback the last migration
npx prisma migrate reset --skip-seed
```

⚠️ **Warning**: `migrate reset` will drop the database and reapply all migrations except the one you want to rollback. Always create a backup first.

### 2. Multiple Migration Rollback

For rolling back multiple migrations:

```bash
# Create a backup first
pg_dump "$DATABASE_URL" > backup_before_rollback_$(date +%Y%m%d_%H%M%S).sql

# Reset to a specific migration
npx prisma migrate reset --skip-seed

# Manually apply migrations up to the target version
npx prisma migrate deploy --to <migration-version>
```

### 3. Emergency Rollback (Production)

For production emergencies:

1. **Immediate Actions**:
   ```bash
   # Stop the application
   kubectl scale deployment backend --replicas=0
   
   # Create database backup
   pg_dump "$DATABASE_URL" > emergency_backup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **Rollback Procedure**:
   ```bash
   # Identify the problematic migration
   npx prisma migrate status
   
   # Reset to previous known good state
   npx prisma migrate reset --skip-seed --force
   
   # Apply migrations up to the safe point
   npx prisma migrate deploy --to <last-safe-migration>
   ```

3. **Verification**:
   ```bash
   # Verify database schema
   npx prisma validate
   
   # Check migration status
   npx prisma migrate status
   
   # Test application connectivity
   npm run test:e2e:ci
   ```

4. **Restore Service**:
   ```bash
   # Restart the application
   kubectl scale deployment backend --replicas=3
   
   # Monitor application health
   kubectl get pods -l app=backend
   ```

## Migration Lock File Management

The `migration_lock.toml` file ensures migration consistency across environments:

### Lock File Validation

```bash
# Verify lock file exists and is valid
if [ ! -f prisma/migrations/migration_lock.toml ]; then
    echo "❌ Migration lock file missing"
    exit 1
fi

# Check provider consistency
if ! grep -q "provider = \"postgresql\"" prisma/migrations/migration_lock.toml; then
    echo "❌ Migration lock file has incorrect provider"
    exit 1
fi
```

### Lock File Recovery

If the lock file becomes corrupted:

1. **Backup Current State**:
   ```bash
   cp prisma/migrations/migration_lock.toml prisma/migrations/migration_lock.toml.backup
   ```

2. **Regenerate Lock File**:
   ```bash
   # Remove corrupted lock file
   rm prisma/migrations/migration_lock.toml
   
   # Regenerate from current migrations
   npx prisma migrate deploy
   ```

## Rollback Validation Checklist

Before proceeding with any rollback:

- [ ] Database backup created and verified
- [ ] Application stopped to prevent data corruption
- [ ] Migration lock file backed up
- [ ] Team notified of maintenance window
- [ ] Rollback plan documented and approved
- [ ] Test environment rollback tested successfully

After rollback completion:

- [ ] Database schema validated with `npx prisma validate`
- [ ] Migration status shows no pending migrations
- [ ] Application health checks passing
- [ ] Smoke tests completed successfully
- [ ] Team notified of rollback completion

## Common Issues and Solutions

### Issue: Migration conflicts after rollback

**Solution**: Use `prisma migrate resolve` to resolve conflicts:
```bash
npx prisma migrate resolve --applied <migration-name>
npx prisma migrate resolve --rolled-back <migration-name>
```

### Issue: Seed data fails after rollback

**Solution**: Manually clean and reseed:
```bash
# Clean existing seed data
npx prisma db seed --reset

# Reapply seed data
npm run seed
```

### Issue: Lock file inconsistency

**Solution**: Regenerate lock file from current state:
```bash
rm prisma/migrations/migration_lock.toml
npx prisma migrate deploy
```

## Emergency Contacts

- **Database Administrator**: [DBA contact]
- **DevOps Lead**: [DevOps contact]
- **Engineering Manager**: [Manager contact]

## Monitoring and Alerts

Set up monitoring for:
- Migration failures in CI/CD
- Database connection errors during migrations
- Long-running migration operations
- Schema validation failures

Alert thresholds:
- Migration duration > 10 minutes
- Migration failure rate > 0%
- Database connection errors > 5/minute
