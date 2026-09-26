# BullMQ Per-Queue Concurrency Configuration

Each queue worker can be configured with a specific concurrency level to control how many jobs are processed in parallel.

## Configuration

Set `QUEUE_CONCURRENCY_MAP` as a comma-separated list of `queue-name=N` pairs:

```
QUEUE_CONCURRENCY_MAP=tx-submit=1,claim-events=5,claim-payouts=3
```

## Default Values

| Queue | Default Concurrency | Rationale |
|-------|---------------------|-----------|
| `tx-submit` | 1 | Nonce-safe: serializes Stellar XDR submission to prevent nonce race conditions |
| `claim-events` | 5 | Typical event indexing workload |
| `claim-payouts` | 3 | Moderate payout processing capacity |

## Observability

Active worker count per queue is exposed as `bullmq_queue_active_workers` gauge in Prometheus:

```
bullmq_queue_active_workers{queue="tx-submit"} 1
bullmq_queue_active_workers{queue="claim-events"} 4
bullmq_queue_active_workers{queue="claim-payouts"} 2
```

## Tuning

- **Increase concurrency** for I/O-bound jobs (database, RPC calls) that can safely parallelize
- **Decrease concurrency** for CPU-bound jobs or to reduce resource contention
- **Monitor active worker gauge** in Grafana to detect saturation or underutilization
- **tx-submit must remain at 1** to prevent Soroban account nonce conflicts across transactions
