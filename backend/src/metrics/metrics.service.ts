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
  readonly graphqlOperationDuration: client.Histogram<string>;
  readonly graphqlOperationTotal: client.Counter<string>;

  // ── Queue / DLQ metrics ───────────────────────────────────────────────────
  readonly dlqDepth: client.Gauge<string>;
  readonly dlqJobFailed: client.Counter<string>;

  // ── Indexer / observability metrics ───────────────────────────────────────
  readonly indexerLag: client.Gauge<string>;
  readonly solvencyBufferStroops: client.Gauge<string>;
  readonly solvencyBufferThresholdStroops: client.Gauge<string>;

  // ── RPC metrics ───────────────────────────────────────────────────────────
  readonly rpcCallDuration: client.Histogram<string>;
  readonly rpcCallTotal: client.Counter<string>;
  readonly rpcErrorTotal: client.Counter<string>;
  /** result: hit | miss | bypass — quote simulation Redis cache */
  readonly quoteSimulationCacheTotal: client.Counter<string>;

  // ── DB pool metrics ───────────────────────────────────────────────────────
  /** Number of connections currently executing a query. */
  readonly dbPoolActive: client.Gauge<string>;
  /** Number of idle connections in the pool. */
  readonly dbPoolIdle: client.Gauge<string>;
  /** Number of requests waiting for a free connection. */
  readonly dbPoolWaiting: client.Gauge<string>;

  // ── Redis cache metrics ───────────────────────────────────────────────────
  /** Total cache hits by key namespace (policy, claim, idempotency, …). */
  readonly redisCacheHits: client.Counter<string>;
  /** Total cache misses by key namespace. */
  readonly redisCacheMisses: client.Counter<string>;
  /** Total Redis connection errors. */
  readonly redisConnectionErrors: client.Counter<string>;

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

    this.graphqlOperationDuration = new client.Histogram({
      name: 'graphql_operation_duration_seconds',
      help: 'GraphQL operation latency in seconds',
      labelNames: ['operation_type', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.graphqlOperationTotal = new client.Counter({
      name: 'graphql_operations_total',
      help: 'Total GraphQL operations',
      labelNames: ['operation_type', 'status'],
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

    this.indexerLag = new client.Gauge({
      name: 'indexer_lag_ledgers',
      help: 'Current indexer lag in ledger count behind the network head',
      labelNames: ['network'],
      registers: [this.registry],
    });

    this.solvencyBufferStroops = new client.Gauge({
      name: 'solvency_buffer_stroops',
      help: 'Contract solvency buffer in stroops (balance minus approved obligations)',
      labelNames: ['tenant'],
      registers: [this.registry],
    });

    this.solvencyBufferThresholdStroops = new client.Gauge({
      name: 'solvency_buffer_threshold_stroops',
      help: 'Configured solvency buffer threshold in stroops',
      labelNames: ['tenant'],
      registers: [this.registry],
    });

    this.rpcCallDuration = new client.Histogram({
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

    this.dbPoolActive = new client.Gauge({
      name: 'db_pool_active',
      help: 'Number of DB connections currently executing a query',
      registers: [this.registry],
    });

    this.dbPoolIdle = new client.Gauge({
      name: 'db_pool_idle',
      help: 'Number of idle DB connections in the pool',
      registers: [this.registry],
    });

    this.dbPoolWaiting = new client.Gauge({
      name: 'db_pool_waiting',
      help: 'Number of requests waiting for a free DB connection',
      registers: [this.registry],
    });

    this.redisCacheHits = new client.Counter({
      name: 'redis_cache_hits_total',
      help: 'Total Redis cache hits by key namespace',
      labelNames: ['namespace'],
      registers: [this.registry],
    });

    this.redisCacheMisses = new client.Counter({
      name: 'redis_cache_misses_total',
      help: 'Total Redis cache misses by key namespace',
      labelNames: ['namespace'],
      registers: [this.registry],
    });

    this.redisConnectionErrors = new client.Counter({
      name: 'redis_connection_errors_total',
      help: 'Total Redis connection errors',
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

  recordGraphqlOperation(opts: {
    operationType: string;
    status: 'success' | 'error' | 'rejected';
    durationMs: number;
  }) {
    const durationSec = opts.durationMs / 1000;
    this.graphqlOperationDuration.observe(
      { operation_type: opts.operationType, status: opts.status },
      durationSec,
    );
    this.graphqlOperationTotal.inc({
      operation_type: opts.operationType,
      status: opts.status,
    });
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

  recordIndexerLag(opts: { network: string; lag: number }) {
    this.indexerLag.set({ network: opts.network }, opts.lag);
  }

  recordSolvencyBuffer(opts: { tenant: string; bufferStroops: bigint }) {
    this.solvencyBufferStroops.set({ tenant: opts.tenant }, Number(opts.bufferStroops));
  }

  recordSolvencyThreshold(opts: { tenant: string; thresholdStroops: bigint }) {
    this.solvencyBufferThresholdStroops.set(
      { tenant: opts.tenant },
      Number(opts.thresholdStroops),
    );
  }

  recordDbPool(opts: { active: number; idle: number; waiting: number }) {
    this.dbPoolActive.set(opts.active);
    this.dbPoolIdle.set(opts.idle);
    this.dbPoolWaiting.set(opts.waiting);
  }

  recordRedisCache(result: 'hit' | 'miss', namespace: string) {
    if (result === 'hit') {
      this.redisCacheHits.inc({ namespace });
    } else {
      this.redisCacheMisses.inc({ namespace });
    }
  }

  recordRedisConnectionError() {
    this.redisConnectionErrors.inc();
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
