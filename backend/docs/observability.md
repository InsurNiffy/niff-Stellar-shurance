# Observability Guide

## Metrics — `/metrics`

The `/metrics` endpoint (not prefixed with `/api`) exposes Prometheus text format.
Restrict it at the ingress/firewall level — it must not be publicly reachable.

### HTTP metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Request latency. Buckets: 10 ms → 10 s |
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total requests |
| `http_5xx_errors_total` | Counter | `method`, `route` | 5xx responses only |

### RPC metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `rpc_call_duration_seconds` | Histogram | `rpc_method`, `status` | Soroban RPC call latency |
| `rpc_calls_total` | Counter | `rpc_method`, `status` | Total RPC calls |
| `rpc_errors_total` | Counter | `rpc_method`, `error_type` | RPC errors by type |

`rpc_method` values: `simulate_generate_premium`, `build_initiate_policy`,
`build_file_claim`, `send_transaction`, `get_events`, `get_latest_ledger`.

`error_type` values: `client_error`, `unavailable`, `unknown`.

### Quote simulation cache

| Metric | Type | Labels | Description |
|---|---|---|---|
| `quote_simulation_cache_requests_total` | Counter | `result` | `hit` = Redis served; `miss` = computed via RPC; `bypass` = `Cache-Control: no-cache` |

See [quote-simulation-cache.md](./quote-simulation-cache.md) for TTL and invalidation.

### Cardinality notes

- `route` is normalised: numeric path segments → `:id`, UUIDs → `:uuid`,
  Stellar addresses → `:address`. Raw URLs are never used as labels.
- `status_code` is the exact HTTP code (200, 400, 404, 500…). The set is
  bounded so cardinality is safe.
- Never add wallet addresses, policy IDs, or claim IDs as metric labels.

---

## Structured JSON Logs

All log entries are newline-delimited JSON written to stdout.
Ship to your centralised stack (Loki, CloudWatch, Datadog, etc.) via the
container log driver.

### Log field dictionary

| Field | Type | Description |
|---|---|---|
| `timestamp` | ISO 8601 | UTC time of the log entry |
| `level` | string | `error` / `warn` / `info` / `debug` |
| `message` | string | Human-readable summary |
| `service` | string | Always `niffyinsure-api` |
| `requestId` | string | Correlation ID — propagated from `x-request-id` header or generated as a UUID |
| `method` | string | HTTP verb (GET, POST, …) |
| `url` | string | Request path only — query string is omitted to avoid leaking tokens |
| `statusCode` | number | HTTP response status |
| `durationMs` | number | Request duration in milliseconds |
| `ip` | string | Client IP address |
| `userAgent` | string | `User-Agent` header value |
| `context` | string | NestJS class / module name |
| `stack` | string | Error stack trace (error level only) |
| `rpcMethod` | string | Soroban RPC method name (RPC log entries only) |
| `rpcStatus` | string | `success` or `error` (RPC log entries only) |
| `contentLength` | number | Response body size in bytes |

### Fields intentionally omitted

- `Authorization` / `Cookie` / `x-api-key` headers — always `[REDACTED]`
- Request and response bodies — never logged
- IPFS file contents — never logged
- Private keys, seeds, mnemonics, Ed25519 signatures
- Full wallet addresses in log messages (use short prefix for debugging)

### Request ID propagation

Every request receives a `requestId`:
1. If the client sends `x-request-id`, that value is used.
2. Otherwise a UUID v4 is generated.

The ID is echoed back in the `x-request-id` response header and included in
every log entry and error response body for end-to-end correlation.

---

## Grafana Dashboard

Import `docs/grafana-dashboard.json` into Grafana (Dashboards → Import).
Select your Prometheus datasource when prompted.

Panels:
- Request rate by route/method
- HTTP latency p50 / p95 / p99
- 5xx error rate
- RPC call rate by method
- RPC error rate
- RPC latency p95
- Node.js heap usage
- Event loop lag

---

## Alerting

Load `docs/prometheus-alerts.yml` into your Prometheus `rule_files`.

| Alert | Threshold | Severity |
|---|---|---|
| `High5xxRate` | > 1 errors/s for 10 min | critical |
| `HighRpcErrorRate` | > 0.5 errors/s for 10 min | warning |
| `HighP99Latency` | p99 > 3 s for 10 min | warning |
| `HighRpcP95Latency` | p95 > 8 s for 10 min | warning |
| `IndexerLagHigh` | > 30 ledger lag for 10 min | warning |
| `SolvencyBufferLow` | buffer below configured threshold | critical |
| `DlqDepthHigh` | dead-letter queue depth > 10 for 5 min | critical |

#### Operator Runbook

- `High5xxRate` / `HighRpcErrorRate`: first check for recent deploys, service restarts, and API gateway errors. If the issue is transient, acknowledge and continue monitoring; if not, escalate to backend engineering and rollback the most recent deployment if required.
- `HighP99Latency` / `HighRpcP95Latency`: review traces and Prometheus panels for the affected route / RPC method. Look for slow Soroban RPC calls, database contention, or request storms before expanding the incident.
- `IndexerLagHigh`: inspect the indexer queue and database cursor. Confirm whether the indexer is stalled, retrying with repeated failures, or simply catching up after a backlog. Use `/admin/queues` and query `ledger_cursors` to diagnose.
- `SolvencyBufferLow`: verify the latest solvency snapshot in the admin dashboard and check approved claims versus contract balance. If the buffer is below the configured safety threshold, open an on-call incident and notify finance/compliance.
- `DlqDepthHigh`: use Bull Board or `/admin/queues/:queue/jobs/:jobId/retry` to replay failed jobs. Investigate the failure reason from `bullmq_dlq_jobs_total` labels and address the root cause before mass retries.

---

## OpenTelemetry Extension Point

`AppLoggerService.structured()` is the single place to inject OTel trace
context. When you add `@opentelemetry/sdk-node`:

```ts
// In app-logger.service.ts — structured()
import { trace } from '@opentelemetry/api';
const span = trace.getActiveSpan();
const traceId = span?.spanContext().traceId;
const spanId  = span?.spanContext().spanId;
this.winston.log(level, message, { ...fields, traceId, spanId });
```

Similarly, `MetricsService.recordHttpRequest` / `recordRpcCall` map directly
to OTel `Meter` histogram/counter calls — swap the prom-client calls for OTel
Meter API calls when you're ready to migrate.

## Queue Dashboard — `/admin/queues`

Bull Board is mounted at `/admin/queues`. It requires a valid admin JWT in the
`Authorization: Bearer <token>` header. No token or a non-admin token returns 401/403.

## Dead-Letter Queue (DLQ)

Jobs that fail `DLQ_MAX_ATTEMPTS` (5) times are moved to BullMQ's **failed** set.
Two metrics track this:

| Metric | Type | Labels | Description |
|---|---|---|---|
| `bullmq_dlq_depth` | Gauge | `queue` | Current failed-job count per queue |
| `bullmq_dlq_jobs_total` | Counter | `queue`, `job_name`, `failure_reason` | Cumulative jobs exhausted |

Alert `DlqDepthHigh` fires when `bullmq_dlq_depth > 10` for 5 minutes.
The alert annotation includes the queue name and links to the replay endpoint.

### Manual Job Replay

1. Open Bull Board at `https://<host>/admin/queues` (admin JWT required) and
   identify the failed job id from the UI.
2. Or query the API:
   ```
   GET /api/admin/queues   # via Bull Board UI
   ```
3. Replay a single job:
   ```
   POST /api/admin/queues/:queue/jobs/:jobId/retry
   Authorization: Bearer <admin-jwt>
   ```
   The job is moved back to `waiting` and retried from scratch.
   An audit row is written with actor, queue, and jobId.
4. To bulk-replay all failed jobs on a queue, use the Bull Board UI
   "Retry all" button — it is equivalent to calling retry on each job.

### Queues monitored

| Queue | Max attempts | Purpose |
|---|---|---|
| `indexer` | 5 | Soroban ledger event indexing |
| `notifications` | 5 | Claim-finalized email/Discord/Telegram |
| `claim-events` | 5 | Raw claim event DB writes |
| `reindex` | 5 | Admin-triggered ledger reindex |
