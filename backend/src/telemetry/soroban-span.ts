import { Span, SpanStatusCode, Tracer, trace } from '@opentelemetry/api';

/**
 * Attributes attached to every Soroban RPC span so traces in Jaeger can be
 * filtered by contract and method.
 */
export interface SorobanSpanAttributes {
  /** Soroban contract ID (StrKey `C...`) the call targets, when applicable. */
  contractId?: string;
  /** RPC method name, e.g. `getLedgerEntries`, `simulateTransaction`. */
  method: string;
  /** Optional RPC endpoint for debugging multi-network setups. */
  endpoint?: string;
}

const TRACER_NAME = 'soroban-rpc';

function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

function applyAttributes(span: Span, attrs: SorobanSpanAttributes): void {
  span.setAttribute('soroban.method', attrs.method);
  if (attrs.contractId) {
    span.setAttribute('soroban.contract_id', attrs.contractId);
  }
  if (attrs.endpoint) {
    span.setAttribute('soroban.endpoint', attrs.endpoint);
  }
}

/**
 * Run `fn` inside a Soroban RPC span tagged with the contract ID and method.
 * Errors are recorded on the span and re-thrown so retry/breaker logic upstream
 * still observes them.
 */
export async function withSorobanSpan<T>(
  attrs: SorobanSpanAttributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = getTracer().startSpan(`soroban.rpc.${attrs.method}`);
  applyAttributes(span, attrs);

  try {
    const result = await fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error) {
      span.recordException(error);
    }
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Synchronous variant for span-wrapped work that does not return a promise.
 */
export function withSorobanSpanSync<T>(
  attrs: SorobanSpanAttributes,
  fn: (span: Span) => T,
): T {
  const span = getTracer().startSpan(`soroban.rpc.${attrs.method}`);
  applyAttributes(span, attrs);

  try {
    const result = fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error) {
      span.recordException(error);
    }
    throw error;
  } finally {
    span.end();
  }
}
