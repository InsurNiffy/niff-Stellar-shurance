import { trace, SpanStatusCode, Span } from '@opentelemetry/api';

const tracer = trace.getTracer('soroban-rpc');

/**
 * Wraps a Soroban RPC simulation call in an OpenTelemetry span.
 * Records contractId, method, and network as span attributes.
 */
export async function traceSorobanSimulation<T>(
  contractId: string,
  method: string,
  network: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    `soroban.simulate ${method}`,
    { attributes: { 'soroban.contract_id': contractId, 'soroban.method': method, 'stellar.network': network } },
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    },
  );
}
