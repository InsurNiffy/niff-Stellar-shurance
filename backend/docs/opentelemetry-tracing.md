# OpenTelemetry Tracing

Distributed tracing is implemented via `@opentelemetry/sdk-node` with auto-instrumentation for HTTP, Prisma/PostgreSQL, and Redis (ioredis). Soroban RPC simulation calls are wrapped with a custom span helper.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | _(unset — no-op)_ | OTLP HTTP endpoint, e.g. `http://localhost:4318` |
| `OTEL_SERVICE_NAME` | `niffyinsure-backend` | Service name in traces |
| `OTEL_SAMPLING_RATIO` | `1.0` (dev) / `0.1` (prod) | Head-sampling ratio 0.0–1.0 |

When `OTEL_EXPORTER_OTLP_ENDPOINT` is not set, the SDK runs with a no-op exporter — no traces are exported and there is no performance overhead.

## Local Development with Jaeger

Run Jaeger all-in-one (includes OTLP HTTP receiver on port 4318):

```bash
docker run --rm -d \
  -p 16686:16686 \
  -p 4318:4318 \
  --name jaeger \
  jaegertracing/all-in-one:latest
```

Then set in your `.env`:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=niffyinsure-backend
OTEL_SAMPLING_RATIO=1.0
```

Open the Jaeger UI at http://localhost:16686 and select the `niffyinsure-backend` service.

## Trace Correlation with Logs

Every incoming request attaches `x-request-id` as a span attribute (`request.id`). Structured log entries include the same `requestId` field, enabling correlation between traces and logs.

## Sensitive Data Policy

- XDR payloads and private keys **must never** appear as span attributes.
- Request/response bodies are not captured by auto-instrumentation (body capture hooks are disabled).
- Only `soroban.contract_id` and `soroban.method` are recorded for Soroban RPC spans.

## Soroban RPC Spans

Use `withSorobanSpan` from `src/common/tracing/soroban-span.ts` to wrap simulation calls:

```typescript
import { withSorobanSpan } from '@/common/tracing/soroban-span'

const result = await withSorobanSpan(
  { contractId: 'C...', method: 'simulateTransaction', requestId },
  () => server.simulateTransaction(tx),
)
```

## Production Sampling

The default production sampling ratio is `0.1` (10%). Adjust via `OTEL_SAMPLING_RATIO` without redeployment.
