# Cross-Layer Correlation ID Guide

Tracing a single user action from the frontend, through the backend, to any resulting
Soroban contract call currently relies on the `x-request-id` header and the `requestId`
field already threaded through backend logs and traces (see
[`backend/docs/opentelemetry-tracing.md`](../backend/docs/opentelemetry-tracing.md)). This
guide documents the end-to-end flow and how to use it when investigating an issue.

## How it flows today

1. **Backend (origin of truth today):** [`RequestIdMiddleware`](../backend/src/common/tracing/request-id.middleware.ts)
   reads `x-request-id` from the incoming request, or generates a new UUID if absent, sets it
   back on `req.headers['x-request-id']`, and echoes it on the response via the
   `x-request-id` header. It is also attached to the active OTel span as `http.request_id`.
2. **Backend logs:** [`RequestIdService`](../backend/src/common/tracing/request-id.service.ts)
   exposes the current request's id; [`AppLoggerService`](../backend/src/common/logger/app-logger.service.ts)
   and [`LoggerMiddleware`](../backend/src/common/middleware/logger.middleware.ts) include it as
   `requestId` on every structured log line for that request.
3. **Contract call context:** `withSorobanSpan` (see
   [`backend/src/common/tracing/soroban-span.ts`](../backend/src/common/tracing/soroban-span.ts),
   used by [`soroban.service.ts`](../backend/src/rpc/soroban.service.ts) and
   [`tx.service.ts`](../backend/src/tx/tx.service.ts)) accepts a `requestId` and records it
   alongside `soroban.contract_id` / `soroban.method` on the span for that RPC call.
4. **Frontend today:** [`frontend/src/lib/api/fetch.ts`](../frontend/src/lib/api/fetch.ts) reads
   `x-request-id` (or `x-correlation-id`) back off the *response* and surfaces it in
   `AppError.requestId` for error reporting/toasts, but does not yet mint an id up front.

## Convention: generate the correlation ID on the frontend

To correlate a single user action (not just a single HTTP call) across retries and
multi-request flows, the frontend should generate the id **before** the first request for
that action, rather than only relying on the id the backend assigns:

- Generate a UUID (`crypto.randomUUID()`) once per user-initiated action (e.g. "submit claim",
  "connect wallet", "buy policy").
- Send it as the `x-request-id` header on every request that belongs to that action.
- The existing backend middleware already honors an incoming `x-request-id` instead of
  generating its own, so no backend change is required for the header to be respected.
- Reuse the same id for retries of the same logical action so all attempts correlate; mint a
  new id for a genuinely new action.

## Using the correlation ID to investigate an issue

1. Get the `x-request-id` from: the failed response header, `AppError.requestId` in a
   frontend error boundary/toast, or the id the user/support ticket reports.
2. **Backend logs:** search structured logs for `requestId: "<id>"` to see every log line for
   that request across services/middleware.
3. **Traces:** in Jaeger (see `backend/docs/opentelemetry-tracing.md`), search by the
   `http.request_id` span attribute to find the full trace, including any Soroban RPC spans
   (`soroban.contract_id`, `soroban.method`) tagged with the same id.
4. **Contract call context:** cross-reference the Soroban span's `contractId`/`method` with
   on-chain data (Horizon/RPC explorer) for the same time window to confirm which ledger
   operation resulted from the request.
5. If the id only appears in the frontend error but not in backend logs/traces, the request
   never reached the backend (network/client-side failure) — narrow the investigation to the
   frontend/network layer instead.
