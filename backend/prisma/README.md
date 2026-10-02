# Prisma — database module

## Overview

The backend uses [Prisma](https://www.prisma.io/) as its ORM against a PostgreSQL 16 database.
Two client instances are available:

| Service | File | Purpose |
|---|---|---|
| `PrismaService` | `src/prisma/prisma.service.ts` | Primary read-write client |
| `PrismaReplicaService` | `src/prisma/prisma-replica.service.ts` | Read-only replica; falls back to primary when `DATABASE_REPLICA_URL` is unset |

## Schema ownership

Each model is owned by a backend domain module. The schema comments mark the owner.

| Model | Owner module | Notes |
|---|---|---|
| `Claim` | `claims` | Soft-delete via `deletedAt` |
| `Vote` | `claims` | Soft-delete via `deletedAt` |
| `Policy` | `policy` | Soft-delete via `deletedAt` |
| `HolderProfile` | `profile` | |
| `ClaimComment` | `claims` | Soft-delete via `deletedAt` |
| `AppealVoterSnapshot` | `claims` | |
| `LedgerCursor` | `indexer` | |
| `FeatureFlag` | `feature-flags` | |
| `WebhookSubscription` | `webhooks` | |

### Soft-delete

Models with `deletedAt` are never hard-deleted from the database. `PrismaService`
applies a global extension that automatically appends `AND deleted_at IS NULL` to
`findMany` / `findFirst` / `count` queries on those models. Pass
`withSoftDeleteBypass()` when you need to query deleted rows (admin endpoints only).

## Migration history

The project **keeps the full migration history** — it was not squashed.

### Why we kept it

The migration history was evaluated against the following criteria:

- All migrations apply cleanly on a fresh Postgres 16 database (`prisma migrate deploy`).
- No migration references a now-deleted table or column.
- `011_add_reindex_progress.sql` (outside Prisma's naming scheme) is handled below.

Squashing was rejected because the team has existing staging and production databases
where `prisma migrate resolve` would need to be run per-environment. The migration
history provides a clear audit trail of schema intent.

### `011_add_reindex_progress.sql`

This file lives in `prisma/migrations/` but does not follow Prisma's timestamp naming
convention. It was added manually during an incident and has already been applied to all
known databases.

**Procedure for new environments:** run `prisma migrate resolve --applied 011_add_reindex_progress`
after the initial `prisma migrate deploy` if the migration table shows it as pending.

## Commands

| Command | What it does |
|---|---|
| `npm run db:migrate` | Apply all pending migrations (`prisma migrate deploy`) |
| `npm run db:seed` | Insert deterministic dev data (idempotent upserts) |
| `npm run db:reset` | Drop and recreate the database, re-apply all migrations |
| `npm run prisma:generate` | Regenerate the Prisma client after schema changes |
| `npm run prisma:studio` | Open Prisma Studio in the browser |

## Replica fallback

`PrismaReplicaService` reads `DATABASE_REPLICA_URL` from the environment. When that
variable is absent or empty, the service silently falls back to the primary database URL.
This means the service is always available — callers do not need to handle a missing
replica.

Unit tests for the fallback live in `src/prisma/prisma.service.spec.ts`.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | Primary database connection string (Postgres) |
| `DATABASE_REPLICA_URL` | No | `DATABASE_URL` | Read replica; falls back to primary |
| `DB_POOL_MAX` | No | `10` | Maximum pool connections |
| `DB_POOL_MIN` | No | `2` | Minimum warm connections |
| `DB_POOL_IDLE_TIMEOUT_MS` | No | `30000` | Reclaim idle connections after N ms |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | No | `5000` | Fail fast after N ms |
