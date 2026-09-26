# Alert Inventory — Current Alert Rule Definitions

**Last inventory update:** 2026-08-28  
**Source files:** 
- `backend/docs/prometheus-alerts.yml` (niffyinsure_api group)
- `backend/docs/prometheus-rules.yml` (niffyinsure_http_sla, niffyinsure_http_errors groups)

This document enumerates every currently-defined alert rule in the repository as it exists in code. This is a factual snapshot of the rule definitions themselves — **no interpretation of fire frequency or actionability is included**. See [Alert Fatigue Review Process](./alert-fatigue-review-process.md) for the methodology for evaluating these rules in production.

---

## Overview

| Group | Alert Count | Recording Rules | Severity Distribution |
|-------|:-:|:-:|---|
| niffyinsure_api | 11 | — | 5 critical, 6 warning |
| niffyinsure_http_sla | 3 | 3 | 1 critical, 2 warning |
| niffyinsure_http_errors | 1 | — | 1 warning |
| niffyinsure_rpc_cost | — | 2 | (recording rules only) |
| **Total** | **15 alerts** | **5 recording rules** | **6 critical, 9 warning** |

---

## Detailed Inventory

### Group: niffyinsure_api

#### 1. High5xxRate
- **Severity:** critical
- **Team:** backend
- **Condition:** `sum(rate(http_5xx_errors_total{app="niffyinsure-api"}[10m])) > 1`
- **Duration:** for 5m
- **Threshold:** >1 error/s (aggregated across all routes) over 10-minute window
- **Component:** HTTP error handling (niffyinsure-api service)
- **Runbook:** None provided in definition
- **Notes:** Fires on aggregated 5xx rate; lacks per-route granularity

#### 2. HighRpcErrorRate
- **Severity:** warning
- **Team:** backend
- **Condition:** `sum(rate(rpc_errors_total{app="niffyinsure-api"}[10m])) > 0.5`
- **Duration:** for 5m
- **Threshold:** >0.5 error/s over 10-minute window
- **Component:** Soroban RPC integration
- **Runbook:** None provided in definition
- **Notes:** Lacks detail on which RPC method; no suggested troubleshooting

#### 3. HighP99Latency
- **Severity:** warning
- **Team:** backend
- **Condition:** `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{app="niffyinsure-api"}[10m])) by (le)) > 3`
- **Duration:** for 10m
- **Threshold:** p99 latency >3 s over 10-minute window
- **Component:** HTTP request performance (niffyinsure-api service)
- **Runbook:** None provided in definition
- **Notes:** Overlaps with CriticalP95Latency rule (same metric, different percentile/threshold)

#### 4. HighRpcP95Latency
- **Severity:** warning
- **Team:** backend
- **Condition:** `histogram_quantile(0.95, sum(rate(rpc_call_duration_seconds_bucket{app="niffyinsure-api"}[10m])) by (le, rpc_method)) > 8`
- **Duration:** for 10m
- **Threshold:** RPC p95 latency >8 s over 10-minute window
- **Component:** Soroban RPC integration
- **Runbook:** None provided in definition
- **Notes:** Per-method granularity via `$labels.rpc_method`; high threshold (8 s) may miss moderate degradation

#### 5. IndexerLagHigh
- **Severity:** warning
- **Team:** backend
- **Condition:** `max_over_time(indexer_lag_ledgers{app="niffyinsure-api"}[10m]) > 30`
- **Duration:** for 10m
- **Threshold:** >30 ledgers behind network head
- **Component:** Indexer (ledger lag tracking)
- **Runbook:** None provided in definition
- **Notes:** 30-ledger threshold; ~5s per ledger = ~150s behind is acceptable per definition

#### 6. SolvencyBufferLow
- **Severity:** critical
- **Team:** backend
- **Condition:** `solvency_buffer_stroops{app="niffyinsure-api"} < solvency_buffer_threshold_stroops{app="niffyinsure-api"}`
- **Duration:** for 5m
- **Threshold:** Buffer value < configured threshold (dynamic)
- **Component:** Contract solvency / treasury
- **Runbook:** None provided in definition
- **Notes:** Threshold is dynamic (configuration-driven); no absolute value specified in rule

#### 7. DlqDepthHigh
- **Severity:** critical
- **Team:** backend
- **Condition:** `bullmq_dlq_depth{app="niffyinsure-api"} > 10`
- **Duration:** for 5m
- **Threshold:** >10 failed jobs in dead-letter queue
- **Component:** BullMQ job queue (failed job handling)
- **Runbook:** Provided inline; references `/api/admin/queues/{queue}/jobs/{jobId}/retry` endpoint
- **Notes:** Includes remediation guidance (POST retry endpoint); per-queue granularity via `$labels.queue`

#### 8. RedisCacheHitRateLow
- **Severity:** warning
- **Team:** backend
- **Condition:** `(sum(rate(redis_cache_hits_total{app="niffyinsure-api"}[10m])) / (sum(rate(redis_cache_hits_total{app="niffyinsure-api"}[10m])) + sum(rate(redis_cache_misses_total{app="niffyinsure-api"}[10m])))) < 0.5`
- **Duration:** for 10m
- **Threshold:** Hit rate <50% over 10-minute window
- **Component:** Redis cache layer
- **Runbook:** None provided in definition
- **Notes:** Threshold (50%) is unusually low for a cache; may mask eviction pressure

#### 9. RedisConnectionErrors
- **Severity:** critical
- **Team:** backend
- **Condition:** `sum(rate(redis_connection_errors_total{app="niffyinsure-api"}[5m])) > 0`
- **Duration:** for 2m
- **Threshold:** Any connection errors (>0) over 5-minute window
- **Component:** Redis connectivity
- **Runbook:** None provided in definition
- **Notes:** **Permissive threshold:** fires on any error >0; likely to be noisy if transient errors occur. Notes rate limiting and nonce auth are affected.

#### 10. IndexerLedgerGapHigh
- **Severity:** warning
- **Team:** backend
- **Condition:** `indexer_ledger_gap{app="niffyinsure-api"} > 100`
- **Duration:** for 10m
- **Threshold:** >100 ledgers behind network head
- **Component:** Indexer (ledger processing)
- **Runbook:** None provided in definition
- **Notes:** Overlaps with IndexerLagHigh (both track indexer behind-ness); gap threshold (100) is higher than lag threshold (30)

#### 11. IndexerLastLedgerAgeHigh
- **Severity:** critical
- **Team:** backend
- **Condition:** `indexer_last_processed_ledger_age_seconds{app="niffyinsure-api"} > 300`
- **Duration:** for 5m
- **Threshold:** No new ledger processed in >300 s (5 minutes)
- **Component:** Indexer (stall detection)
- **Runbook:** None provided in definition
- **Notes:** Clear semantic meaning (indexer stall); well-reasoned in comments (~5s per ledger, 5-min gap is strong signal)

---

### Group: niffyinsure_http_sla

#### 12. HighP95Latency
- **Severity:** warning
- **Team:** backend
- **Condition:** `job:http_request_duration_seconds:p95_5m > 1` (uses recording rule)
- **Duration:** for 5m
- **Threshold:** p95 latency >1 s over 5-minute window
- **Component:** HTTP request performance (per-route SLA tracking)
- **Runbook:** `https://docs.niffyinsure.com/runbooks/high-latency`
- **Notes:** **Linked runbook provided**. Per-route granularity. Lower threshold (1s) than HighP99Latency in niffyinsure_api (3s).

#### 13. CriticalP95Latency
- **Severity:** critical
- **Team:** backend
- **Condition:** `job:http_request_duration_seconds:p95_5m > 3` (uses recording rule)
- **Duration:** for 2m
- **Threshold:** p95 latency >3 s over 5-minute window (SLA breach)
- **Component:** HTTP request performance (per-route SLA tracking)
- **Runbook:** `https://docs.niffyinsure.com/runbooks/high-latency`
- **Notes:** **Linked runbook provided**. Critical threshold for same metric as #12; shorter duration (2m vs 5m). Overlaps with HighP99Latency.

#### 14. SLAComplianceBelow99Pct
- **Severity:** warning
- **Team:** backend
- **Condition:** `job:http_request_sla_1s:ratio_5m < 0.99` (uses recording rule)
- **Duration:** for 5m
- **Threshold:** <99% of requests complete within 1 s over 5-minute window
- **Component:** HTTP request performance (SLA compliance tracking)
- **Runbook:** `https://docs.niffyinsure.com/runbooks/sla-breach`
- **Notes:** **Linked runbook provided**. Per-route granularity. Complements latency alerts with SLA-framed metric.

---

### Group: niffyinsure_http_errors

#### 15. High5xxErrorRate
- **Severity:** warning
- **Team:** backend
- **Condition:** `(sum(rate(http_5xx_errors_total{app="niffyinsure-api"}[5m])) by (route) / sum(rate(http_requests_total{app="niffyinsure-api"}[5m])) by (route)) > 0.01`
- **Duration:** for 3m
- **Threshold:** 5xx error rate >1% (per-route) over 5-minute window
- **Component:** HTTP error handling (per-route error tracking)
- **Runbook:** `https://docs.niffyinsure.com/runbooks/5xx-errors`
- **Notes:** **Linked runbook provided**. Per-route granularity. **Overlaps with High5xxRate:** same metric, different aggregation (per-route vs aggregated), different window (5m vs 10m), different threshold (1% vs 1 err/s).

---

## Recording Rules (Non-Alerting)

These metrics are pre-aggregated for dashboard performance but do not fire alerts directly.

### Group: niffyinsure_http_sla

1. **job:http_request_duration_seconds:p95_5m** — p95 latency per route (5m window)
2. **job:http_request_duration_seconds:p99_5m** — p99 latency per route (5m window)
3. **job:http_request_sla_1s:ratio_5m** — SLA compliance ratio: requests ≤1s per route (5m window)

### Group: niffyinsure_rpc_cost

4. **job:appeal_rpc_calls:rate5m** — Appeal-attributable RPC call rate, per method (build_file_appeal, finalize_appeal)
5. **job:appeal_rpc_calls:ratio5m** — Appeal share of total RPC cost as a ratio (0–1)

---

## Structural Observations

### Runbook Coverage
- **12 of 15 alerts lack a runbook link** in their rule definitions (only alerts #12, #13, #14, #15 provide one)
- Alerts with runbooks (#12–#15) are all in the niffyinsure_http_sla and niffyinsure_http_errors groups
- niffyinsure_api group (11 alerts) has no runbook links at all

### Overlaps & Potential Duplicates
1. **5xx error tracking:** High5xxRate (aggregated, >1 err/s, 10m) vs High5xxErrorRate (per-route %, >1%, 5m)
2. **Indexer lag:** IndexerLagHigh (>30 ledgers) vs IndexerLedgerGapHigh (>100 ledgers) — both measure behind-ness; different thresholds/durations
3. **Latency tracking:** HighP99Latency (p99 >3s) vs HighP95Latency (p95 >1s) vs CriticalP95Latency (p95 >3s) — three alerts on similar metrics, different thresholds/percentiles/durations

### Threshold Observations
- **RedisConnectionErrors:** threshold >0 (any error fires the alert) — structurally permissive
- **RedisCacheHitRateLow:** threshold <50% — unusually low for a cache; 50% miss rate suggests operational problem but may not be rare
- **HighRpcP95Latency:** 8 s threshold is high; may miss moderate degradation
- **SolvencyBufferLow:** threshold is dynamic (configuration), not visible in rule definition

### Severity Distribution
- **Critical (6):** High5xxRate, SolvencyBufferLow, DlqDepthHigh, RedisConnectionErrors, IndexerLastLedgerAgeHigh, CriticalP95Latency
- **Warning (9):** HighRpcErrorRate, HighP99Latency, HighRpcP95Latency, IndexerLagHigh, RedisCacheHitRateLow, IndexerLedgerGapHigh, HighP95Latency, SLAComplianceBelow99Pct, High5xxErrorRate

---

## Next Steps

See [Alert Fatigue Review Process](./alert-fatigue-review-process.md) for the documented quarterly review methodology that evaluates these rules against actual fire-frequency and actionability data from the live monitoring system.
