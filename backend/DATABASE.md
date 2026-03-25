# Database Documentation

## Overview

This document describes the PostgreSQL database schema for the Niffy Stellar Insurance system.

## Table of Contents

- [Architecture](#architecture)
- [Docker Compose Reset Workflow](#docker-compose-reset-workflow)
- [Transactional Boundaries](#transactional-boundaries)
- [Backup/Restore Expectations](#backuprestore-expectations)
- [Foreign Key Strategy](#foreign-key-strategy)
- [Multi-Tenancy](#multi-tenancy)
- [Running Migrations](#running-migrations)
- [Seeding Demo Data](#seeding-demo-data)

## Architecture

### Core Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts (holders, staff, admins) |
| `policies` | Insurance policies |
| `claims` | Insurance claims |
| `votes` | Governance votes on claims |
| `raw_events` | Raw blockchain events for ingestion |
| `ledger_cursors` | Last processed ledger per ingestion type |
| `notification_preferences` | User notification settings |
| `audit_logs` | Admin audit trail |

### Numeric Type Usage

All monetary values use `NUMERIC(20,0)` to store token minor units (e.g., stroops for XLM). Floats are intentionally avoided to prevent rounding errors.

## Docker Compose Reset Workflow

### Starting the Database

```bash
cd backend
docker-compose up -d
```

### Resetting the Database (Development)

To completely reset the database and start fresh:

```bash
# 1. Stop and remove containers
docker-compose down -v

# 2. Start fresh
docker-compose up -d
```

The `-v` flag removes the named volume (`postgres_data`), ensuring a completely fresh database.

### Using the Reset Script

```bash
# From backend directory
npm run db:reset

# Or manually:
docker-compose down -v && docker-compose up -d
```

### Connecting to the Database

```bash
# Via docker exec
docker exec -it niff_stellar_db psql -U niff_user -d niff_stellar

# Or via docker-compose
docker-compose exec postgres psql -U niff_user -d niff_stellar
```

### Environment Variables

Create a `.env` file in the `backend` directory:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=niff_user
DB_PASSWORD=niff_password
DB_NAME=niff_stellar
```

## Transactional Boundaries

### Ingestion Batches

When processing blockchain events in batches, use transactions to ensure atomicity:

```typescript
async function processEvents(events: RawEvent[]): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  
  try {
    await queryRunner.startTransaction();
    
    for (const event of events) {
      await processEvent(event, queryRunner);
    }
    
    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
```

### Claim Creation with Votes

Creating a claim should be atomic to prevent partial data:

```typescript
async function createClaimWithVotes(
  claimData: CreateClaimDto,
  votes: CreateVoteDto[]
): Promise<Claim> {
  return dataSource.transaction(async (manager) => {
    // 1. Create claim
    const claim = await manager.save(Claim, {
      ...claimData,
      status: ClaimStatus.SUBMITTED,
    });
    
    // 2. Create votes in same transaction
    const savedVotes = await Promise.all(
      votes.map((vote) =>
        manager.save(Vote, {
          ...vote,
          claimId: claim.id,
        })
      )
    );
    
    // 3. Update claim vote counts atomically
    claim.voteCount = savedVotes.length;
    claim.approvalCount = savedVotes.filter((v) => v.voteType === VoteType.APPROVE).length;
    claim.rejectionCount = savedVotes.filter((v) => v.voteType === VoteType.REJECT).length;
    
    return manager.save(Claim, claim);
  });
}
```

### Transaction Rules

1. **Always use transactions** for multi-step operations that modify related data
2. **Rollback on any failure** - do not leave partial data
3. **Use QueryRunner** for explicit control over transactions in complex scenarios
4. **Keep transactions short** - avoid long-running operations within a single transaction

## Backup/Restore Expectations

### Backup Strategy

For production environments:

1. **Daily Full Backups**
   ```bash
   pg_dump -U niff_user -d niff_stellar -F c -b -v -f niff_stellar_$(date +%Y%m%d).dump
   ```

2. **WAL Archiving** (for point-in-time recovery)
   - Enable WAL archiving in PostgreSQL config
   - Ship WAL segments to object storage

3. **Point-in-Time Recovery (PITR)**
   - Keep WAL archives for at least 7 days
   - Can recover to any point within the retention period

### Restore Procedure

```bash
# Full restore
pg_restore -U niff_user -d niff_stellar -c niff_stellar_YYYYMMDD.dump

# PITR restore (requires WAL setup)
pg_restore -PITR-target="2024-01-15 14:30:00" ...
```

### Development Environment

For local development:
```bash
# Quick dump
docker exec niff_stellar_db pg_dump -U niff_user niff_stellar > backup.sql

# Quick restore
cat backup.sql | docker exec -i niff_stellar_db psql -U niff_user niff_stellar
```

## Foreign Key Strategy

### Cascade Rules

| Parent Table | Child Table | On Delete | Rationale |
|-------------|-------------|-----------|-----------|
| users | policies | RESTRICT | Cannot delete user with active policies |
| users | claims | RESTRICT | Cannot delete user with pending claims |
| users | votes | RESTRICT | Cannot delete user with recorded votes |
| users | notification_preferences | CASCADE | Delete preferences when user is deleted |
| policies | claims | RESTRICT | Cannot delete policy with claims |
| claims | votes | CASCADE | Votes are tied to claim lifecycle |
| users | audit_logs | SET NULL | Keep audit log even if user is deleted |

### Soft Deletes vs Hard Deletes

- **Soft deletes preferred** for: Users, Policies, Claims
  - Use `isActive` flag or `deletedAt` timestamp
  - Maintains referential integrity
  - Preserves audit trail

- **Hard deletes** for: Votes, Raw Events, Ledger Cursors
  - These are append-only or derived data
  - Can be recreated from source

### Implementing Soft Delete

```typescript
@Entity()
class SoftDeletable {
  @Column({ default: false })
  isDeleted!: boolean;
  
  @Column({ nullable: true })
  deletedAt?: Date;
  
  @Column({ nullable: true })
  deletedBy?: string;
}
```

## Multi-Tenancy

### Tenant ID Column

All tables include a nullable `tenantId` column (UUID) for future multi-tenancy support:

```sql
ALTER TABLE users ADD COLUMN tenant_id UUID;
ALTER TABLE policies ADD COLUMN tenant_id UUID;
ALTER TABLE claims ADD COLUMN tenant_id UUID;
-- etc.
```

### Current Implementation

- `tenantId` is nullable (single-tenant mode)
- Add index on `tenantId` for future queries
- Application-level tenant filtering can be added later

### Future Migration

```sql
-- When enabling multi-tenancy:
UPDATE users SET tenant_id = 'default-tenant-id' WHERE tenant_id IS NULL;
ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;
```

## Running Migrations

### Prerequisites

1. Ensure PostgreSQL is running:
   ```bash
   docker-compose up -d
   ```

2. Ensure environment variables are set

### Running Migrations

```bash
# Run all pending migrations
npm run migration:run

# Generate a new migration from changes
npm run migration:generate -- --name MigrationName

# Revert last migration
npm run migration:revert
```

### Verify Migrations

```bash
# Check migration status
docker exec -it niff_stellar_db psql -U niff_user -d niff_stellar -c "SELECT * FROM typeorm_migrations;"
```

## Seeding Demo Data

### Run Seed SQL

```bash
# Via docker exec
docker exec -i niff_stellar_db psql -U niff_user -d niff_stellar < src/database/seed.sql

# Or via docker-compose
docker-compose exec -T postgres psql -U niff_user -d niff_stellar < src/database/seed.sql
```

### Verify Seed Data

```bash
docker exec -it niff_stellar_db psql -U niff_user -d niff_stellar -c "SELECT COUNT(*) FROM users;"
```

Expected output:
- Users: 5
- Policies: 5
- Claims: 5
- Votes: 3
- Raw events: 12

## Indexes

### Query Optimization

The following indexes support common queries:

| Index | Tables | Columns | Purpose |
|-------|--------|---------|---------|
| `IDX_users_stellarAddress` | users | stellarAddress | User lookup by Stellar address |
| `IDX_policies_tenantId_holderId` | policies | tenantId, holderId | Policy lookup by holder |
| `IDX_claims_tenantId_status` | claims | tenantId, status | Claims by status |
| `IDX_claims_tenantId_createdAt` | claims | tenantId, createdAt | Recent claims |
| `IDX_votes_tenantId_claimId` | votes | tenantId, claimId | Votes for a claim |
| `IDX_raw_events_ledgerTimestamp` | raw_events | ledgerTimestamp | Event time-series |
| `IDX_audit_logs_tenantId_createdAt` | audit_logs | tenantId, createdAt | Audit queries |

## Acceptance Criteria Verification

- [x] Fresh database applies all migrations cleanly in CI and locally
- [x] Seeds produce a usable demo environment for frontend development
- [x] Ingestion uses transactions and leaves no partial claim rows on failure