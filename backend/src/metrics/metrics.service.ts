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

  // ── GraphQL complexity metrics ────────────────────────────────────────────
  /**
   * Total GraphQL queries rejected for exceeding depth/complexity limits.
   * Labels:
   *  - `reason`: depth | complexity
   */
  readonly graphqlComplexityRejectedTotal: client.Counter<string>;

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
  /** Requests that arrived without X-Correlation-ID (one was generated). */
  readonly correlationIdMissingTotal: client.Counter<string>;

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

  // ── Appeal metrics ─────────────────────────────────────────────────────────
  /**
   * Total appeal submissions opened by claimants.
   * Incremented in ClaimsService.submitAppealTransaction after successful submission.
   */
  readonly appealsOpenedTotal: client.Counter<string>;

  /**
   * Total appeals resolved as approved.
   * Incremented by the indexer when it decodes an appeal_approved event.
   */
  readonly appealsApprovedTotal: client.Counter<string>;

  /**
   * Total appeals resolved as rejected.
   * Incremented by the indexer when it decodes an appeal_rejected event.
   */
  readonly appealsRejectedTotal: client.Counter<string>;

  /**
   * Current number of in-flight (open) appeals that have not yet been resolved.
   * Gauge: +1 on open, -1 on resolved (approved or rejected).
   */
  readonly appealsInFlightGauge: client.Gauge<string>;

  /**
   * Number of UNDER_APPEAL claims past appeal_deadline_ledger + grace (#1348).
   */
  readonly appealsSlaStuckGauge: client.Gauge<string>;

  /** Appeal SLA monitor job failures. */
  readonly appealsSlaCheckErrorsTotal: client.Counter<string>;

  // ── Business KPIs ─────────────────────────────────────────────────────
  readonly claimsFiledTotal: client.Counter<string>;
  /** Labels: status (APPROVED | REJECTED | PAID …) */
  readonly claimsResolvedTotal: client.Counter<string>;
  readonly activePoliciesGauge: client.Gauge<string>;
  /** Treasury balance in stroops. */
  readonly treasuryBalanceGauge: client.Gauge<string>;
  /** Ledgers between chain tip and the last indexed ledger. */
  readonly indexerLedgerLagGauge: client.Gauge<string>;

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

    this.graphqlComplexityRejectedTotal = new client.Counter({
      name: 'graphql_complexity_rejected_total',
      help: 'Total GraphQL queries rejected for exceeding depth/complexity limits',
      labelNames: ['reason'],
      registers: [this.registry],
    });

    this.dlqDepth = new client.Gauge({
      name: 'dlq_depth',
      help: 'Number of jobs currently in the dead-letter queue',
      registers: [this.registry],
    });

    this.dlqJobFailed = new client.Counter({
      name: 'dlq_jobs_failed_total',
      help: 'Total jobs moved to the dead-letter queue',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.queueActiveWorkers = new client.Gauge({
      name: 'queue_active_workers',
      help: 'Number of active workers per queue',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.queueDepth = new client.Gauge({
      name: 'queue_depth',
      help: 'Number of waiting jobs per queue',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.bullmqJobRetriesTotal = new client.Counter({
      name: 'bullmq_job_retries_total',
      help: 'Total BullMQ job retries',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.jobProcessingDuration = new client.Histogram({
      name: 'job_processing_duration_seconds',
      help: 'BullMQ job processing latency in seconds',
      labelNames: ['queue'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.indexerLag = new client.Gauge({
      name: 'indexer_lag_ledgers',
      help: 'Indexer lag in ledgers behind chain tip',
      registers: [this.registry],
    });

    this.indexerLedgerGap = new client.Gauge({
      name: 'indexer_ledger_gap',
      help: 'Gap between last indexed ledger and chain tip',
      registers: [this.registry],
    });

    this.indexerLastLedgerAge = new client.Gauge({
      name: 'indexer_last_ledger_age_seconds',
      help: 'Age of the last indexed ledger in seconds',
      registers: [this.registry],
    });

    this.solvencyBufferStroops = new client.Gauge({
      name: 'solvency_buffer_stroops',
      help: 'Current solvency buffer in stroops',
      registers: [this.registry],
    });

    this.solvencyBufferThresholdStroops = new client.Gauge({
      name: 'solvency_buffer_threshold_stroops',
      help: 'Configured solvency buffer threshold in stroops',
      registers: [this.registry],
    });

    this.rpcCallDuration = new client.Histogram({
      name: 'rpc_call_duration_seconds',
      help: 'Soroban RPC call latency in seconds',
      labelNames: ['rpc_method', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
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
      labelNames: ['rpc_method'],
      registers: [this.registry],
    });

    this.quoteSimulationCacheTotal = new client.Counter({
      name: 'quote_simulation_cache_total',
      help: 'Quote simulation Redis cache results',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.claimSummaryCacheTotal = new client.Counter({
      name: 'claim_summary_cache_total',
      help: 'Claims board summary Redis cache results',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.correlationIdMissingTotal = new client.Counter({
      name: 'correlation_id_missing_total',
      help: 'Total requests received without an X-Correlation-ID header',
      registers: [this.registry],
    });

    this.slowQueriesTotal = new client.Counter({
      name: 'slow_queries_total',
      help: 'Total queries exceeding the slow query threshold',
      labelNames: ['operation'],
      registers: [this.registry],
    });

    this.dbPoolActive = new client.Gauge({
      name: 'db_pool_active_connections',
      help: 'Number of connections currently executing a query',
      registers: [this.registry],
    });

    this.dbPoolIdle = new client.Gauge({
      name: 'db_pool_idle_connections',
      help: 'Number of idle connections in the pool',
      registers: [this.registry],
    });

    this.dbPoolWaiting = new client.Gauge({
      name: 'db_pool_waiting_requests',
      help: 'Number of requests waiting for a free connection',
      registers: [this.registry],
    });

    this.indexerDuplicateEvents = new client.Counter({
      name: 'indexer_duplicate_events_total',
      help: 'Total duplicate events detected during indexing',
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
      help: 'Total vote tally mismatches detected between indexed and on-chain state',
      registers: [this.registry],
    });

    this.voteReconciliationErrors = new client.Counter({
      name: 'vote_reconciliation_errors_total',
      help: 'Total vote reconciliation errors during checking',
      registers: [this.registry],
    });

    this.voteReconciliationMismatchCount = new client.Counter({
      name: 'vote_reconciliation_mismatch_count_total',
      help: 'Total mismatches found in a single reconciliation run',
      registers: [this.registry],
    });

    this.vacuumOperationsTotal = new client.Counter({
      name: 'vacuum_operations_total',
      help: 'Total VACUUM operations run against high-churn tables',
      labelNames: ['table'],
      registers: [this.registry],
    });

    this.tableBloatRatio = new client.Gauge({
      name: 'table_bloat_ratio',
      help: 'Table bloat ratio (percentage of dead tuples) per high-churn table',
      labelNames: ['table'],
      registers: [this.registry],
    });

    this.claimNotificationBatchTotal = new client.Counter({
      name: 'claim_notification_batch_total',
      help: 'Total claim notification batch accumulate/flush operations',
      labelNames: ['operation'],
      registers: [this.registry],
    });

    this.appealsOpenedTotal = new client.Counter({
      name: 'appeals_opened_total',
      help: 'Total appeal submissions opened by claimants',
      registers: [this.registry],
    });

    this.appealsApprovedTotal = new client.Counter({
      name: 'appeals_approved_total',
      help: 'Total appeals resolved as approved',
      registers: [this.registry],
    });

    this.appealsRejectedTotal = new client.Counter({
      name: 'appeals_rejected_total',
      help: 'Total appeals resolved as rejected',
      registers: [this.registry],
    });

    this.appealsInFlightGauge = new client.Gauge({
      name: 'appeals_in_flight',
      help: 'Current number of in-flight (open) appeals',
      registers: [this.registry],
    });

    this.appealsSlaStuckGauge = new client.Gauge({
      name: 'appeals_sla_stuck',
      help: 'Number of UNDER_APPEAL claims past appeal deadline + grace',
      registers: [this.registry],
    });

    this.appealsSlaCheckErrorsTotal = new client.Counter({
      name: 'appeals_sla_check_errors_total',
      help: 'Appeal SLA monitor job failures',
      registers: [this.registry],
    });

    this.claimsFiledTotal = new client.Counter({
      name: 'claims_filed_total',
      help: 'Total claims filed',
      registers: [this.registry],
    });

    this.claimsResolvedTotal = new client.Counter({
      name: 'claims_resolved_total',
      help: 'Total claims resolved, by final status',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.activePoliciesGauge = new client.Gauge({
      name: 'active_policies_gauge',
      help: 'Number of currently active policies',
      registers: [this.registry],
    });

    this.treasuryBalanceGauge = new client.Gauge({
      name: 'treasury_balance_gauge',
      help: 'Treasury balance in stroops',
      registers: [this.registry],
    });

    this.indexerLedgerLagGauge = new client.Gauge({
      name: 'indexer_ledger_lag',
      help: 'Ledgers between chain tip and last indexed ledger',
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    // Reserved for future OTel bridge wiring.
  }

  /**
   * Record a GraphQL query rejected for exceeding depth/complexity limits.
   * reason: 'depth' | 'complexity'
   */
  recordIndexerLag(args: { network: string; lag: number }): void {
    this.indexerLag.set(args.lag);
    this.indexerLedgerLagGauge.set(args.lag);
  }

  recordGraphqlComplexityRejected(reason: 'depth' | 'complexity'): void {
    this.graphqlComplexityRejectedTotal.inc({ reason });
  }

  /**
   * Expose the Prometheus registry for the /metrics endpoint.
   */
  getRegistry(): client.Registry {
    return this.registry;
  }
}
