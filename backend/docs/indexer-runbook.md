# Indexer Runbook

## Batch Size Tuning

### Configuration

```env
INDEXER_BATCH_SIZE=10   # default; valid range: 1–100
```

Change takes effect on next process restart. No code change required.

### Impact on RPC rate-limit consumption

Each `processBatch` call issues **one** RPC request regardless of batch size.
Larger batches → fewer RPC calls per unit time → lower rate-limit pressure.
Smaller batches → more RPC calls → higher rate-limit pressure but lower latency per batch.

Public Soroban RPC endpoints (Testnet): ~100 req/min per IP.
At `INDEXER_BATCH_SIZE=10` and a 1-second poll interval: ~60 req/min — within limits.
At `INDEXER_BATCH_SIZE=1` and a 1-second poll interval: ~60 req/min — same call rate, but each call fetches only 1 ledger.

### Decision tree

```
Is indexer_batch_duration_ms_avg > 5000 ms?
  YES → Reduce INDEXER_BATCH_SIZE (try halving it)
  NO  →
    Is the indexer falling behind (lag > 100 ledgers)?
      YES →
        Are you hitting RPC 429 errors?
          YES → Reduce INDEXER_BATCH_SIZE or add a dedicated RPC provider
          NO  → Increase INDEXER_BATCH_SIZE (try doubling, up to 100)
      NO  → Current batch size is appropriate; no change needed
```

### Recommended values by scenario

| Scenario | Recommended INDEXER_BATCH_SIZE |
|---|---|
| Normal steady-state | 10 (default) |
| Catch-up after downtime (no rate-limit pressure) | 50–100 |
| Catch-up with public RPC (rate-limited) | 20–30 |
| Debugging / slow RPC provider | 1–5 |

### Metric to watch

`indexer_batch_duration_ms_avg` — visible in the Prometheus `/metrics` endpoint.

Alert threshold: > 8 000 ms average → reduce batch size or investigate RPC latency.
