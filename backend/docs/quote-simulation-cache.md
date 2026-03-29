# Quote simulation Redis cache

## Purpose

`POST /api/quote/generate-premium` can simulate `generate_premium` on Soroban for every request, which adds latency and consumes RPC rate limits. A short-TTL Redis cache stores **successful on-chain simulation results** keyed by a deterministic hash of normalized quote inputs.

## Key design

- **Cache key**: `quote:sim:v1:` + SHA-256 of `CONTRACT_ID`, `STELLAR_NETWORK_PASSPHRASE`, and canonical JSON of sorted fields: `age`, `coverage_tier`, `policy_type`, `region`, `risk_score`, `source_account` (empty string if omitted).
- **Stored value**: JSON of `{ premiumStroops, premiumXlm, minResourceFee, source: "simulation", inputs }` — same shape as the API response body (excluding redundant `inputs` merge).
- **Not cached**:
  - Responses with `source: "local_fallback"` (contract simulation error path inside `SorobanService`).
  - Any thrown error (e.g. `ACCOUNT_NOT_FOUND`, `WRONG_NETWORK`) — transient failures must not be pinned in Redis.
  - Requests **without** `source_account` (local-only path; no RPC reduction target).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `QUOTE_SIMULATION_CACHE_ENABLED` | `true` | Set to `false` or `0` to disable read/write. |
| `QUOTE_SIMULATION_CACHE_TTL_SECONDS` | `30` | Redis TTL per entry (1–600 seconds in validation). |

## TTL tradeoffs

- **Too long**: Clients may see **stale premiums** after on-chain multiplier table updates until TTL expires or cache is invalidated.
- **Too short**: **More RPC traffic** and less benefit; tune against Soroban quotas and p95 quote latency.

Operational mitigation: the indexer clears all `quote:sim:v1:*` keys when it observes contract event `niffyins:tbl_upd` (multiplier table update). Short TTL remains a safety bound.

## Bypass

Send header `Cache-Control: no-cache` (exact directive `no-cache` among comma-separated values). The handler skips Redis get/set and records metric `quote_simulation_cache_requests_total{result="bypass"}`.

## Metrics

Prometheus counter **`quote_simulation_cache_requests_total`** with label **`result`**:

- `hit` — served from Redis
- `miss` — cache empty/disabled, performed simulation
- `bypass` — `no-cache` request

Use hit/(hit+miss) on dashboards for cache effectiveness (exclude bypass from denominator if desired).
