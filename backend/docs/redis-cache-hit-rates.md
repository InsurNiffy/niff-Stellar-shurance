# Redis Cache Hit Rates

## Metrics

| Metric | Description |
|---|---|
| `redis_cache_hits_total{namespace}` | Counter — cache hits by key namespace |
| `redis_cache_misses_total{namespace}` | Counter — cache misses by key namespace |
| `redis_connection_errors_total` | Counter — ioredis connection errors |

Namespace label values map to the first segment of the Redis key:

| Namespace | Key pattern | TTL |
|---|---|---|
| `cache` | `cache:policy:*`, `cache:claim:*` | 30 s (policy), 10 s (claim) |
| `nonce` | `nonce:<address>` | 5 min |
| `ratelimit` | `ratelimit:<identifier>` | 60 s |
| `idempotency` | `idempotency:<hash>` | 24 h |

## Expected Hit Rates

| Cache type | Expected hit rate | Notes |
|---|---|---|
| Policy reads | ≥ 70 % | 30 s TTL; high read-to-write ratio in steady state |
| Claim reads | ≥ 50 % | 10 s TTL; claim status changes more frequently |
| Idempotency | ≥ 90 % | Only retried requests hit this; misses are first-time requests |
| Nonce | ~0 % | Nonces are consumed on first use (atomic GET+DEL) |
| Rate limit | N/A | Counters, not cached values — not tracked as hit/miss |

A sustained overall hit rate below **50 %** triggers the `RedisCacheHitRateLow` Prometheus alert (see `docs/prometheus-alerts.yml`).

## Degraded behaviour

Redis is a cache layer only — Postgres is authoritative for all financial data.

| Operation | Redis down behaviour |
|---|---|
| Policy / claim reads | Cache miss → falls through to DB |
| Rate limiting | Fail open — requests are allowed through |
| Wallet-auth nonces | Fail closed — auth is rejected (`RedisUnavailableError`) |
| BullMQ job queues | Fail closed — job not enqueued, caller receives error |

The `/health` endpoint returns `503` with `redis: down` when Redis is unreachable.
