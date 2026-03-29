import { Injectable, OnModuleInit } from '@nestjs/common';
import * as client from 'prom-client';

/**
 * MetricsService — single source of truth for all Prometheus metrics.
 *
 * Cardinality rules (to avoid Prometheus blowups):
 *  - `method`  : HTTP verb only (GET/POST/…) — never full path params
 *  - `route`   : normalised route pattern (/claims/:id) — never raw URLs
 *  - `status`  : HTTP status code bucketed to class (2xx/4xx/5xx) OR exact code
 *                for the histogram; exact code for counters is fine because the
 *                set is bounded.
 *  - `rpc_method`: one of a fixed enum of Soroban RPC calls
 *
 * Extension point for OpenTelemetry:
 *  Replace the prom-client calls in recordHttpRequest / recordRpcCall with
 *  OTel Meter API calls when you add @opentelemetry/sdk-node. The method
 *  signatures here are intentionally OTel-compatible (name, labels, value).
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: client.Registry;

  // ── HTTP metrics ──────────────────────────────────────────────────────────
  readonly httpRequestDuration: client.Histogram<string>;
  readonly httpRequestTotal: client.Counter<string>;
  readonly http5xxTotal: client.Counter<string>;

  // ── Queue / DLQ metrics ───────────────────────────────────────────────────
  readonly dlqDepth: client.Gauge<string>;
  readonly dlqJobFailed: client.Counter<string>;

  // ── RPC metrics ───────────────────────────────────────────────────────────
  readonly rpcCallDuration: client.Histogram<string>;
  readonly rpcCallTotal: client.Counter<string>;
  readonly rpcErrorTotal: client.Counter<string>;
  /** result: hit | miss | bypass — quote simulation Redis cache */
  readonly quoteSimulationCacheTotal: client.Counter<string>;

  constructor() {
    this.registry = new client.Registry();
    this.registry.setDefaultLabels({ app: 'niffyinsure-api' });

    // Collect default Node.js / process metrics
    client.collectDefaultMetrics({ register: this.registry });

    this.httpRequestDuration = new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds',
      labelNames: ['method', 'route', 'status_code'],
      // Buckets tuned for a JSON API: 10 ms → 10 s
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.httpRequestTotal = new client.Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.http5xxTotal = new client.Counter({
      name: 'http_5xx_errors_total',
      help: 'Total HTTP 5xx responses',
      labelNames: ['method', 'route'],
      registers: [this.registry],
    });

    this.dlqDepth = new client.Gauge({
      name: 'bullmq_dlq_depth',
      help: 'Number of jobs currently in the dead-letter (failed) queue',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.dlqJobFailed = new client.Counter({
      name: 'bullmq_dlq_jobs_total',
      help: 'Total jobs moved to dead-letter queue after max retries',
      labelNames: ['queue', 'job_name', 'failure_reason'],
      registers: [this.registry],
    });

    this.rpcCallDuration = new client.Histogram({
      name: 'rpc_call_duration_seconds',
      help: 'Soroban RPC call latency in seconds',
      labelNames: ['rpc_method', 'status'],
      buckets: [0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [this.registry],
    });

    this.rpcCallTotal = new client.Counter({
      name: 'rpc_calls_total',
      help: 'Total Soroban RPC calls',
      labelNames: ['rpc_method', 'status'],
      registers: [this.registry],
    });

    this.rpcErrorTotal = new client.Counter({
      name: 'rpc_errors_total',
      help: 'Total Soroban RPC errors',
      labelNames: ['rpc_method', 'error_type'],
      registers: [this.registry],
    });

    this.quoteSimulationCacheTotal = new client.Counter({
      name: 'quote_simulation_cache_requests_total',
      help: 'Quote simulation cache lookups (hit/miss/bypass)',
      labelNames: ['result'],
      registers: [this.registry],
    });
  }

  onModuleInit() {
    // Nothing extra needed — metrics are registered in the constructor.
  }

  /** Normalise a raw Express path to a low-cardinality route label. */
  normaliseRoute(path: string): string {
    if (!path) return 'unknown';
    // Strip query string
    const clean = path.split('?')[0];
    // Replace numeric segments and UUIDs with placeholders
    return clean
      .replace(/\/\d+/g, '/:id')
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
      .replace(/\/G[A-Z2-7]{55}/g, '/:address') // Stellar public keys
      .toLowerCase();
  }

  recordHttpRequest(opts: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
  }) {
    const { method, route, statusCode, durationMs } = opts;
    const labels = { method, route, status_code: String(statusCode) };
    const durationSec = durationMs / 1000;

    this.httpRequestDuration.observe(labels, durationSec);
    this.httpRequestTotal.inc(labels);

    if (statusCode >= 500) {
      this.http5xxTotal.inc({ method, route });
    }
  }

  recordRpcCall(opts: {
    rpcMethod: string;
    status: 'success' | 'error';
    durationMs: number;
    errorType?: string;
  }) {
    const { rpcMethod, status, durationMs, errorType } = opts;
    const durationSec = durationMs / 1000;

    this.rpcCallDuration.observe({ rpc_method: rpcMethod, status }, durationSec);
    this.rpcCallTotal.inc({ rpc_method: rpcMethod, status });

    if (status === 'error' && errorType) {
      this.rpcErrorTotal.inc({ rpc_method: rpcMethod, error_type: errorType });
    }
  }

  recordQuoteSimulationCache(result: 'hit' | 'miss' | 'bypass') {
    this.quoteSimulationCacheTotal.inc({ result });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
