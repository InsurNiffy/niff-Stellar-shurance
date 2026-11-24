# OpenTelemetry Tracing

This document describes how the backend emits traces for Soroban RPC calls and
what operational limits the `SorobanRpcService` respects.

## Soroban RPC spans

Every Soroban RPC call is wrapped by the helper in
`backend/src/soroban/soroban-span.ts`. The helper creates a span named
`soroban.rpc` and tags it with:

| Attribute            | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `soroban.contract_id`| The contract ID the call targets (when applicable).      |
| `soroban.method`     | The RPC method invoked (e.g. `getLedgerEntries`, `simulateTransaction`). |
| `soroban.attempt`    | The retry attempt number (1-based).                      |
| `soroban.breaker_state` | Circuit breaker state at call time (`closed`, `open`, `halfOpen`). |

Spans are exported via the configured OTLP exporter and appear in Jaeger under
the service name set by `OTEL_SERVICE_NAME`.

## Retry and circuit breaker

- RPC calls are retried with exponential backoff (3 attempts total).
- An `opossum` circuit breaker opens after 3 consecutive failures and closes
after a successful probe (half-open).
- The breaker state is exposed at `GET /health` under `soroban.breaker`.

## Rate-limit headers

The Soroban RPC provider returns rate-limit headers that the service respects:

- `Retry-After` — seconds to wait before retrying after a `429`.
- `X-RateLimit-Limit` — request budget for the current window.
- `X-RateLimit-Remaining` — remaining requests in the window.
- `X-RateLimit-Reset` — epoch seconds when the window resets.

When `X-RateLimit-Remaining` reaches zero the service backs off until the reset
time instead of hammering the endpoint.

## Horizon finality lag

Horizon and Soroban RPC are not perfectly synchronized. A transaction that is
`SUCCESS` on Soroban RPC may not yet be visible on Horizon, and vice versa.
Consumers should treat Horizon results as eventually consistent and allow for a
finality lag of a few ledgers (~5s per ledger) before considering a state
final. The service does not block on Horizon finality; callers that require
finality should poll until the ledger sequence advances past the transaction's
ledger.
