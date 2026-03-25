# Redis Architecture — NiffyInsure Backend

## Overview

Redis underpins three operational concerns:

| Concern | Implementation | Fail behaviour |
|---------|---------------|----------------|
| Job queues | BullMQ (`claim-events`, `claim-payouts`) | **Fail closed** — job not enqueued returns error |
| Wallet-auth nonces | `setNonce` / `consumeNonce` in `cache.ts` | **Fail closed** — auth rejected if Redis is down |
| Rate limiting | `incrementRateLimit` in `cache.ts` | **Fail open** — request allowed, warning logged |
| Response caching | `cacheGet` / `cacheSet` in `cache.ts` | **Degrade gracefully** — cache miss falls through to DB |

**Redis is never the authoritative store for financial data. Postgres is.**

---

## Key Naming Conventions

All keys are prefixed with `{NODE_ENV}:niffyinsure:` (set as `keyPrefix` in ioredis).

```
{env}:niffyinsure:cache:policy:{holder}:{policy_id}   — policy read cache (30 s TTL)
{env}:niffyinsure:cache:claim:{claim_id}               — claim read cache (10 s TTL)
{env}:niffyinsure:nonce:{address}                      — wallet-auth nonce (5 min TTL)
{env}:niffyinsure:ratelimit:{identifier}               — rate-limit counter (60 s TTL)
{env}:niffyinsure:bull:claim-events:*                  — BullMQ internal keys
{env}:niffyinsure:bull:claim-payouts:*                 — BullMQ internal keys
```

Segments:
- `{env}` — `NODE_ENV` value (`development` | `staging` | `production`)
- `niffyinsure` — service constant; prevents collisions in shared Redis
- `{area}` — `cache` | `nonce` | `ratelimit` | `bull`
- `{id}` — resource-specific identifier

---

## TTL Conventions

Defined in `src/redis/config.ts` as `TTL` — single source of truth.

| Key area | TTL | Rationale |
|----------|-----|-----------|
| Nonce | 5 min | Challenge must be used before wallet session expires |
| Rate limit | 60 s | Sliding window; resets each minute |
| Policy cache | 30 s | Stale-while-revalidate acceptable; policies change infrequently |
| Claim cache | 10 s | Lower TTL; claim status changes on every vote |

---

## Queue Configuration

### `claim-events`

Processes Soroban contract events (ClaimFiled, VoteLogged, ClaimSettled) and writes to Postgres.

| Setting | Value | Rationale |
|---------|-------|-----------|
| `attempts` | 5 | Retry transient failures (network, DB lock) |
| `backoff` | exponential, 1 s base | Avoid thundering herd on DB recovery |
| `concurrency` | 5 per worker | Balance throughput vs DB connection pool |
| `stalledInterval` | 30 s | Redeliver if worker crashes mid-job |
| `maxStalledCount` | 2 | Move to failed after 2 stall cycles |
| `removeOnComplete` | last 100 | Keep for debugging without unbounded growth |
| `removeOnFail` | last 500 | Keep for alerting and manual replay |

**Idempotency requirement**: The Postgres writer must use `INSERT … ON CONFLICT DO NOTHING` keyed on `(ledger, event_index)` — stalled jobs will be redelivered.

### `claim-payouts`

Triggers token transfer for approved claims. Not yet implemented — queue name reserved.

---

## Outage Behaviour

### Redis completely unavailable

| Feature | Behaviour | User impact |
|---------|-----------|-------------|
| Wallet auth (nonce) | **Rejected** — `RedisUnavailableError` thrown | User cannot log in; must retry when Redis recovers |
| Rate limiting | **Allowed** — warning logged | Temporary rate-limit bypass; acceptable short-term risk |
| Policy/claim reads | **DB fallback** — cache miss | Slightly higher DB load; no user-visible impact |
| Job enqueue | **Error returned** — caller must handle | Async processing delayed; no data loss if caller retries |
| `/health/ready` | Returns `503 { redis: "down" }` | Load balancer can route away from degraded instance |

### Redis slow (high latency)

- `checkRedisHealth` has a 2 s timeout — returns `false` if exceeded.
- Cache operations have no explicit timeout; they will block the request. Consider adding per-operation timeouts in production if Redis latency is a concern.

---

## Metrics and Alerting

`GET /metrics/redis` returns:

```json
{
  "connected": true,
  "memory_used_bytes": 1234567,
  "memory_used_mb": 1,
  "queues": {
    "claim-events": {
      "waiting": 0,
      "active": 1,
      "completed": 42,
      "failed": 0,
      "delayed": 0,
      "depth": 1
    }
  }
}
```

Recommended alert thresholds:

| Metric | Threshold | Action |
|--------|-----------|--------|
| `queues["claim-events"].depth` | > 1000 | Scale worker replicas |
| `queues["claim-events"].failed` | > 10 | Investigate; replay failed jobs |
| `memory_used_mb` | > 200 (of 256 limit) | Increase `maxmemory` or scale Redis |
| `connected: false` | any | Page on-call; wallet auth is down |

---

## Local Development

```bash
# Start Redis
docker compose up -d redis

# Set env vars (copy from .env.example)
cp .env.example .env

# Run backend
npm run build && npm start

# Run tests (Redis must be running)
REDIS_HOST=127.0.0.1 npm test
```

---

## Production Security Checklist

- [ ] `REDIS_PASSWORD` set to ≥ 32 random characters
- [ ] `REDIS_TLS=true` with valid CA cert for managed Redis (e.g. AWS ElastiCache, Upstash)
- [ ] Redis not exposed on public network interface
- [ ] `maxmemory` and `maxmemory-policy` configured (`allkeys-lru` recommended)
- [ ] Separate Redis instance (or logical DB) per environment
- [ ] Alerts wired on queue depth and memory usage
- [ ] Redis password rotated on any suspected compromise
