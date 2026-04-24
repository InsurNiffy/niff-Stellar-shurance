/**
 * Utility for wrapping Soroban RPC simulation calls with an OpenTelemetry span.
 *
 * Usage:
 *   const result = await withSorobanSpan(
 *     { contractId: 'C...', method: 'vote' },
 *     () => server.simulateTransaction(tx),
 *   )
 *
 * Sensitive data policy:
 *   - XDR payloads and private keys MUST NOT be passed as span attributes.
 *   - Only contractId and method are recorded.
 */

import { trace, SpanStatusCode, context } from '@opentelemetry/api'

const tracer = trace.getTracer('soroban-rpc')

export interface SorobanSpanOptions {
  /** Contract ID (C... address) — safe to record as a span attribute. */
  contractId: string
  /** RPC method name, e.g. "simulateTransaction", "sendTransaction". */
  method: string
  /** Optional x-request-id for correlation with structured logs. */
  requestId?: string
}

/**
 * Wraps a Soroban RPC call in an OTel span.
 * Records contractId and method as span attributes.
 * Never records XDR, private keys, or other sensitive parameters.
 */
export async function withSorobanSpan<T>(
  opts: SorobanSpanOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(`soroban.${opts.method}`, {
    attributes: {
      'soroban.contract_id': opts.contractId,
      'soroban.method': opts.method,
      ...(opts.requestId ? { 'request.id': opts.requestId } : {}),
    },
  })

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await fn()
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      })
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      span.end()
    }
  })
}
