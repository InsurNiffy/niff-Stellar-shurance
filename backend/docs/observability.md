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
| `High5xxRate` | > 0.5 errors/s for 2 min | critical |
| `HighRpcErrorRate` | > 0.2 errors/s for 2 min | warning |
| `HighP99Latency` | p99 > 3 s for 5 min | warning |
| `HighRpcP95Latency` | p95 > 10 s for 5 min | warning |

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
