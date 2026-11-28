# Database Pool Runbook

This document describes how the backend configures its Prisma connection pool and how to tune it for different environments.

## Overview

The backend wraps `PrismaClient` in a NestJS `PrismaService` (see `backend/src/prisma/prisma.service.ts`). Connection lifecycle is managed through `onModuleInit` / `onModuleDestroy`, and the pool size is controlled by the `connection_limit` query parameter on the database URL.

A separate `PrismaReplicaService` routes read-only queries to a replica database when `DATABASE_REPLICA_URL` is configured. If no replica URL is set, reads fall back to the primary.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | Primary (read/write) PostgreSQL connection string. |
| `DATABASE_REPLICA_URL` | no | Read-only replica connection string. Falls back to `DATABASE_URL` when unset. |
| `DATABASE_CONNECTION_LIMIT` | no | Pool size applied to both primary and replica URLs. Defaults to `10`. |
| `DATABASE_POOL_TIMEOUT` | no | Seconds to wait for a free connection before failing. Defaults to `10`. |

## How `connection_limit` is applied

`PrismaService` reads `DATABASE_CONNECTION_LIMIT` (and `DATABASE_POOL_TIMEOUT`) at startup and appends them to the connection string as query parameters if they are not already present:

```
postgresql://user:pass@host:5432/db?connection_limit=10&pool_timeout=10
```

If the URL already contains `connection_limit`, the explicit value in the URL wins — this lets operators override the env default per environment without code changes.

## Tuning guidance

Pool size should be sized against the database server's `max_connections` and the number of backend replicas.

```
connection_limit ≈ floor((max_connections - reserved) / backend_replicas)
```

Rules of thumb:

- Keep `reserved` at ~10 connections for migrations, admin tooling, and monitoring.
- Start with `connection_limit=10` per instance and adjust based on observed pool wait times.
- If you see `Timed out fetching a new connection from the connection pool`, either raise `connection_limit` or reduce the number of backend replicas.
- Replica pools can be smaller than the primary pool since they only serve read traffic.

## Health checks

`PrismaHealthIndicator` runs `SELECT 1` against the primary connection and is wired into the `/health` endpoint. A failing database connection surfaces as a `down` status on the `database` check.

## Common issues

- **`/health` reports database down**: verify `DATABASE_URL` is reachable from the backend pod and that credentials are valid.
- **Pool exhaustion under load**: increase `DATABASE_CONNECTION_LIMIT` or scale down replicas; check for long-running queries holding connections.
- **Replica lag**: read-only queries routed through `PrismaReplicaService` may return stale data. Use the primary service for read-after-write consistency.
