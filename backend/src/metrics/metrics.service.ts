import { Injectable, OnModuleInit } from '@nestjs/common';
import * as client from 'prom-client';
import { MetricsCardinalityGuard } from './cardinality-guard.service';

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
 *  - `claim_id`: bucketed to ranges (0-999, 1000-1999, ...) via cardinality guard
 *  - `tenant`: normalized to hash or well-known ID via cardinality guard
 *
 * Extension point for OpenTelemetry:
 *  Replace the prom-client calls in recordHttpRequest / recordRpcCall with
 *  OTel Meter API calls when you add @opentelemetry/sdk-node. The method
 *  signatures here are intentionally OTel-compatible (name, labels, value).
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: client.Registry;
  private readonly cardinalityGuard: MetricsCardinalityGuard;

  // ── HTTP metrics ──────────────────────────────────────────────────────────
  readonly httpRequestDuration: client.Histogram<string>;
  readonly httpRequestTotal: client.Counter<string>;
  readonly http5xxTotal: client.Counter<string>;
  readonly graphqlOperationDuration: client.Histogram<string>;
  readonly graphqlOperationTotal: client.Counter<string>;

  // ── Queue / DLQ metrics ───────────────────────────────────────────────────
  readonly dlqDepth: client.Gauge<string>;
  readonly dlqJobFailed: client.Counter<string>;
  readonly queueActiveWorkers: client.Gauge<string>;
  readonly queueDepth: client.Gauge<string>;
  readonly bullmqJobRetriesTotal: client.Counter<string>;
  readonly jobProcessingDuration: client.Histogram<string>;

  // ── Indexer / observability metrics ───────────────────────────────────────
  readonly indexerLag: client.Gauge<string>;
  readonly indexerLedgerGap: client.Gauge<string>;
  readonly indexerLastLedgerAge: client.Gauge<string>;
  readonly solvencyBufferStroops: client.Gauge<string>;
  readonly solvencyBufferThresholdStroops: client.Gauge<string>;

  // ── RPC metrics ───────────────────────────────────────────────────────────
  readonly rpcCallDuration: client.Histogram<string>;
  readonly rpcCallTotal: client.Counter<string>;
  readonly rpcErrorTotal: client.Counter<string>;
  /** result: hit | miss | bypass — quote simulation Redis cache */
  readonly quoteSimulationCacheTotal: client.Counter<string>;
  /** result: hit | miss — claims board summary Redis cache */
  readonly claimSummaryCacheTotal: client.Counter<string>;

  // ── Slow query metrics ────────────────────────────────────────────────────
  /** Total queries exceeding SLOW_QUERY_THRESHOLD_MS. */
  readonly slowQueriesTotal: client.Counter<string>;

  // ── DB pool metrics ───────────────────────────────────────────────────────
  /** Number of connections currently executing a query. */
  readonly dbPoolActive: client.Gauge<string>;
  /** Number of idle connections in the pool. */
  readonly dbPoolIdle: client.Gauge<string>;
  /** Number of requests waiting for a free connection. */
  readonly dbPoolWaiting: client.Gauge<string>;

  // ── Indexer deduplication metrics ────────────────────────────────────────
  /**
   * Total duplicate events detected during indexing (upsert conflict hit).
   * Labels:
   *  - `event_type`: raw_event | vote
   *  - `network`: Stellar network identifier
   */
  readonly indexerDuplicateEvents: client.Counter<string>;

  // ── Redis cache metrics ───────────────────────────────────────────────────
  /** Total cache hits by key namespace (policy, claim, idempotency, …). */
  readonly redisCacheHits: client.Counter<string>;
  /** Total cache misses by key namespace. */
  readonly redisCacheMisses: client.Counter<string>;
  /** Total Redis connection errors. */
  readonly redisConnectionErrors: client.Counter<string>;

  // ── Vote reconciliation metrics ────────────────────────────────────────────
  /** Total vote tally mismatches detected between indexed and on-chain state. */
  readonly voteTallyMismatches: client.Counter<string>;
  /** Total vote reconciliation errors during checking. */
  readonly voteReconciliationErrors: client.Counter<string>;
  /** Total mismatches found in a single reconciliation run. */
  readonly voteReconciliationMismatchCount: client.Counter<string>;

  // ── Maintenance metrics ───────────────────────────────────────────────────
  /** Total VACUUM operations run against high-churn tables. */
  readonly vacuumOperationsTotal: client.Counter<string>;
  /** Table bloat ratio (percentage of dead tuples) per high-churn table. */
  readonly tableBloatRatio: client.Gauge<string>;

  // ── Notification batching metrics ────────────────────────────────────────
  /** Total claim notification batch accumulate/flush operations. */
  readonly claimNotificationBatchTotal: client.Counter<string>;

  constructor(cardinalityGuard: MetricsCardinalityGuard) {
    this.cardinalityGuard = cardinalityGuard;
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

    this.queueActiveWorkers = new client.Gauge({
      name: 'bullmq_queue_active_workers',
      help: 'Number of active workers for a queue (jobs being processed)',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.queueDepth = new client.Gauge({
      name: 'bullmq_queue_depth',
      help: 'Number of jobs currently pending in a queue',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.bullmqJobRetriesTotal = new client.Counter({
      name: 'bullmq_job_retries_total',
      help: 'Total job retry attempts per queue (excludes first attempt and final exhaustion)',
      labelNames: ['queue', 'job_name'],
      registers: [this.registry],
    });

    this.jobProcessingDuration = new client.Histogram({
      name: 'bullmq_job_processing_duration_seconds',
      help: 'Job processing duration in seconds per queue',
      labelNames: ['queue', 'job_name', 'status'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 300],
      registers: [this.registry],
    });

    this.indexerLag = new client.Gauge({
      name: 'indexer_lag_ledgers',
      help: 'Current indexer lag in ledger count behind the network head',
      labelNames: ['network'],
      registers: [this.registry],
    });
    this.indexerLedgerGap = new client.Gauge({      name: 'indexer_ledger_gap',      help: 'Gap between latest chain ledger and last processed ledger',      labelNames: ['network'],      registers: [this.registry],    });

    this.indexerLastLedgerAge = new client.Gauge({
      name: 'indexer_last_processed_ledger_age_seconds',
      help: 'Seconds since the close time of the last ledger processed by the indexer',
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

    this.claimSummaryCacheTotal = new client.Counter({
      name: 'claim_summary_cache_requests_total',
      help: 'Claims board summary cache lookups',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.slowQueriesTotal = new client.Counter({
      name: 'db_slow_queries_total',
      help: 'Total DB queries exceeding the slow query threshold',
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

    this.indexerDuplicateEvents = new client.Counter({
      name: 'indexer_duplicate_events_total',
      help: 'Total duplicate events detected during indexing (upsert conflict)',
      labelNames: ['event_type', 'network'],
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

    this.voteTallyMismatches = new client.Counter({
      name: 'vote_tally_mismatches_total',
      help: 'Total vote tally mismatches detected between indexed DB and on-chain state',
      labelNames: ['claim_id'],
      registers: [this.registry],
    });

    this.voteReconciliationErrors = new client.Counter({
      name: 'vote_reconciliation_errors_total',
      help: 'Total errors during vote reconciliation checks',
      registers: [this.registry],
    });

    this.voteReconciliationMismatchCount = new client.Counter({
      name: 'vote_reconciliation_mismatches_total',
      help: 'Total mismatches detected in a reconciliation run',
      registers: [this.registry],
    });

    this.vacuumOperationsTotal = new client.Counter({
      name: 'db_vacuum_operations_total',
      help: 'Total VACUUM operations run against high-churn tables',
      labelNames: ['table', 'result'],
      registers: [this.registry],
    });

    this.tableBloatRatio = new client.Gauge({
      name: 'db_table_bloat_ratio',
      help: 'Table bloat ratio (percentage of dead tuples) per high-churn table',
      labelNames: ['table'],
      registers: [this.registry],
    });

    this.claimNotificationBatchTotal = new client.Counter({
      name: 'claim_notification_batch_operations_total',
      help: 'Total claim notification batch accumulate/flush operations',
      labelNames: ['action'],
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

  recordClaimSummaryCache(result: 'hit' | 'miss') {
    this.claimSummaryCacheTotal.inc({ result });
  }

  recordIndexerLag(opts: { network: string; lag: number }) {
    this.indexerLag.set({ network: opts.network }, opts.lag);
  }
  recordIndexerLedgerGap(opts: { network: string; gap: number }) {    this.indexerLedgerGap.set({ network: opts.network }, opts.gap);  }

  recordLastProcessedLedgerAge(opts: { network: string; ledgerClosedAt: Date }) {
    const ageSeconds = (Date.now() - opts.ledgerClosedAt.getTime()) / 1000;
    this.indexerLastLedgerAge.set({ network: opts.network }, Math.max(0, ageSeconds));
  }

  recordSolvencyBuffer(opts: { tenant: string; bufferStroops: bigint }) {
    const normalizedTenant = this.cardinalityGuard.normalizeTenantId(opts.tenant);
    this.solvencyBufferStroops.set({ tenant: normalizedTenant }, Number(opts.bufferStroops));
  }

  recordSolvencyThreshold(opts: { tenant: string; thresholdStroops: bigint }) {
    const normalizedTenant = this.cardinalityGuard.normalizeTenantId(opts.tenant);
    this.solvencyBufferThresholdStroops.set(
      { tenant: normalizedTenant },
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

  recordDuplicateEvent(opts: { eventType: 'raw_event' | 'vote'; network: string }) {
    this.indexerDuplicateEvents.inc({ event_type: opts.eventType, network: opts.network });
  }

  recordVoteTallyMismatch(claimId: number) {
    const normalizedClaimId = this.cardinalityGuard.normalizeClaimId(claimId);
    this.voteTallyMismatches.inc({ claim_id: normalizedClaimId });
  }

  recordVoteReconciliationError() {
    this.voteReconciliationErrors.inc();
  }

  recordVoteReconciliationMismatchCount(count: number) {
    this.voteReconciliationMismatchCount.inc({}, count);
  }

  recordJobRetry(opts: { queue: string; jobName: string }) {
    this.bullmqJobRetriesTotal.inc({ queue: opts.queue, job_name: opts.jobName });
  }

  recordQueueActiveWorkers(opts: { queue: string; count: number }) {
    this.queueActiveWorkers.set({ queue: opts.queue }, opts.count);
  }

  recordQueueDepth(opts: { queue: string; depth: number }) {
    this.queueDepth.set({ queue: opts.queue }, opts.depth);
  }

  recordJobProcessingDuration(opts: {
    queue: string;
    jobName: string;
    status: string;
    durationMs: number;
  }) {
    const { queue, jobName, status, durationMs } = opts;
    this.jobProcessingDuration.observe(
      { queue, job_name: jobName, status },
      durationMs / 1000,
    );
  }

  recordVacuumOperation(table: string, result: 'success' | 'failure') {
    this.vacuumOperationsTotal.inc({ table, result });
  }

  recordTableBloat(table: string, bloatRatioPercent: number) {
    this.tableBloatRatio.set({ table }, bloatRatioPercent);
  }

  recordClaimNotificationBatch(
    action: 'accumulated' | 'flushed',
    _opts: { walletAddress: string; eventCount: number },
  ) {
    this.claimNotificationBatchTotal.inc({ action });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
