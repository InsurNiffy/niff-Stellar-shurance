# Alert Review — Preliminary Static Analysis

**Analysis Date:** 2026-08-28  
**Scope:** Static rule definition analysis only  
**Status:** Unvalidated; pending first real review against live fire-frequency data

---

## ⚠️ IMPORTANT DISCLAIMER

This document contains a preliminary, **static-only analysis** of alert rule definitions found in `backend/docs/prometheus-*.yml`. It flags structurally suspicious patterns visible in the rule code itself — missing runbooks, permissive thresholds, duplicate rules, etc. — but it does **NOT** constitute a real alert fatigue review.

**This analysis:**
- ✓ Reads what the rule definitions literally say
- ✓ Flags patterns that suggest structural problems (e.g., no runbook, duplicate logic)
- ✗ Does NOT check actual fire frequency against real data
- ✗ Does NOT correlate fires with production incidents
- ✗ Does NOT make tuning or removal recommendations

**A real review** requires running the [Alert Fatigue Review Process](./alert-fatigue-review-process.md) against live Prometheus fire data and incident tracking. The flags below are a starting checklist for whoever runs that real review.

---

## Flagged Items

### 1. Missing Runbook: RedisConnectionErrors (alert #9)

**Rule:** `RedisConnectionErrors` (niffyinsure_api group)

**Observation:**
```yaml
- alert: RedisConnectionErrors
  expr: |
    sum(rate(redis_connection_errors_total{app="niffyinsure-api"}[5m])) > 0
  for: 2m
  labels:
    severity: critical
    team: backend
  annotations:
    summary: "Redis connection errors detected"
    description: >
      Redis connection errors have been observed for at least 2 minutes.
      Rate limiting is failing open and nonce-based auth will be rejected.
      Restore Redis connectivity immediately.
```

**Why flagged:**
- No `runbook_url` link in annotations
- Severity is **critical** (highest level), but no runbook to guide responders
- References specific consequences ("rate limiting failing open," "nonce-based auth rejected") that suggest clear remediation, but doesn't link to documentation of that remediation

**Next real review should:**
- Verify if a runbook exists elsewhere (wiki, internal docs) that should be linked
- If no runbook exists, create one before the next review cycle
- Confirm whether Redis connection errors are common enough to warrant a critical alert, or if this should be warning

---

### 2. Permissive Threshold: RedisConnectionErrors (alert #9)

**Rule:** Same as above

**Observation:**
```yaml
expr: |
  sum(rate(redis_connection_errors_total{app="niffyinsure-api"}[5m])) > 0
```

**Why flagged:**
- Threshold is `> 0` (any error), not `> 0.1` or similar
- Even transient network glitches (isolated TCP resets, DNS hiccups) that recover instantly will trigger this alert
- Duration is only `for: 2m`, so 2 minutes of any Redis errors → critical alert

**Next real review should:**
- Check Prometheus data: how many times per week does this alert fire?
- Does it correlate with actual Redis outages, or is it firing due to routine transient errors?
- Consider raising threshold to `> 0.1` (some baseline error rate is normal) or increasing duration to `for: 5m`
- If every fire correlates with a customer-impacting incident, keep as-is; if most fires are for 10-second blips, tune

---

### 3. Unusually Low Cache Hit Rate Threshold: RedisCacheHitRateLow (alert #8)

**Rule:** `RedisCacheHitRateLow` (niffyinsure_api group)

**Observation:**
```yaml
- alert: RedisCacheHitRateLow
  expr: |
    (
      sum(rate(redis_cache_hits_total{app="niffyinsure-api"}[10m]))
      /
      (
        sum(rate(redis_cache_hits_total{app="niffyinsure-api"}[10m]))
        + sum(rate(redis_cache_misses_total{app="niffyinsure-api"}[10m]))
      )
    ) < 0.5
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Redis cache hit rate below 50 %"
    description: >
      The overall Redis cache hit rate has been below 50 % for 10 minutes.
      This may indicate cache eviction pressure, a cold-start after a
      Redis restart, or an unexpected traffic pattern. Check Redis memory
      usage and consider increasing maxmemory or TTLs.
```

**Why flagged:**
- Threshold is **50% hit rate** — a cache with only 50% hits is performing poorly, but 50% miss rate (one miss per two requests) is not unusually high for all cache patterns
- Typical healthy caches aim for 80%+ hit rates; 50% is very permissive
- If truly operational, a cache with <50% hits is already in a bad state; alerting at 50% may be too late

**Next real review should:**
- Check Prometheus data: how often does this fire per week?
- Check incident correlation: when it fires, is it always followed by customer-visible latency increases or data consistency issues?
- If it fires rarely and for non-serious events, consider lowering threshold to 70% or 75%
- If it fires frequently, consider breaking down by cache key type (claim summaries, tenant config, etc.) to alert per-cache

---

### 4. High RPC Latency Threshold: HighRpcP95Latency (alert #4)

**Rule:** `HighRpcP95Latency` (niffyinsure_api group)

**Observation:**
```yaml
- alert: HighRpcP95Latency
  expr: |
    histogram_quantile(0.95,
      sum(rate(rpc_call_duration_seconds_bucket{app="niffyinsure-api"}[10m]))
      by (le, rpc_method)
    ) > 8
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Soroban RPC p95 latency above 8 s"
    description: >
      RPC method {{ $labels.rpc_method }} p95 latency exceeded 8 seconds.
      Soroban network may be congested.
```

**Why flagged:**
- Threshold is **8 seconds** for p95 (95th percentile)
- This is very permissive; p95 = 8s means 1-in-20 calls take ≥8 seconds, which is degraded service
- No runbook link to guide on RPC recovery or Soroban network debugging
- Assumes Soroban network degradation, but could also signal local queuing or contract simulation timeout

**Next real review should:**
- Check Prometheus data: how often does this fire per week?
- Correlate with Soroban network status / public incidents
- Consider whether 8s is the right threshold or if 3–5s would be more appropriate for an SLA
- Add a runbook link for RPC latency troubleshooting (may differ from HTTP latency runbook)

---

### 5. Overlapping Rules: High5xxRate vs High5xxErrorRate

**Rules:** `High5xxRate` (alert #1) and `High5xxErrorRate` (alert #15)

**Observation:**

Alert #1:
```yaml
- alert: High5xxRate
  expr: |
    sum(rate(http_5xx_errors_total{app="niffyinsure-api"}[10m])) > 1
  for: 5m
  labels:
    severity: critical
```

Alert #15:
```yaml
- alert: High5xxErrorRate
  expr: |
    sum(rate(http_5xx_errors_total{app="niffyinsure-api"}[5m])) by (route)
    /
    sum(rate(http_requests_total{app="niffyinsure-api"}[5m])) by (route)
    > 0.01
  for: 3m
  labels:
    severity: warning
```

**Why flagged:**
- Both track 5xx errors via `http_5xx_errors_total` metric
- Different aggregation (High5xxRate: total, High5xxErrorRate: per-route %)
- Different thresholds (>1 err/s vs >1% of requests)
- Different windows (10m vs 5m)
- Different durations (5m vs 3m)
- Different severity (critical vs warning)
- Only alert #15 has a runbook link
- If High5xxRate fires (>1 err/s), High5xxErrorRate may also fire (if even one route is >1% errors), creating duplicate notifications

**Next real review should:**
- Clarify the intended scope: do you want a global 5xx alert (High5xxRate) or per-route alerts (High5xxErrorRate)?
- Consider consolidating into a single alert with per-route granularity by default, and a global critical threshold if ALL routes exceed a limit
- If keeping both, document the rationale for different severities and windows

---

### 6. Overlapping Rules: IndexerLagHigh vs IndexerLedgerGapHigh

**Rules:** `IndexerLagHigh` (alert #5) and `IndexerLedgerGapHigh` (alert #10)

**Observation:**

Alert #5:
```yaml
- alert: IndexerLagHigh
  expr: |
    max_over_time(indexer_lag_ledgers{app="niffyinsure-api"}[10m]) > 30
  for: 10m
  labels:
    severity: warning
```

Alert #10:
```yaml
- alert: IndexerLedgerGapHigh
  expr: |
    indexer_ledger_gap{app="niffyinsure-api"} > 100
  for: 10m
  labels:
    severity: warning
```

**Why flagged:**
- Both alert on indexer falling behind the network head
- `indexer_lag_ledgers` vs `indexer_ledger_gap` may be the same metric with different names, or different but related metrics
- Thresholds differ: 30 ledgers vs 100 ledgers (100-ledger gap fires much later)
- Both are severity warning; unclear which is the "primary" signal
- No runbooks for either
- Rule naming suggests synonyms ("lag" vs "gap"), unclear if they're intentionally measuring different things

**Next real review should:**
- Confirm whether these metrics are measuring the same or different things
- Check Prometheus data: do both alerts fire together, or separately?
- If they measure the same thing, consolidate to one alert; if different, clarify naming and thresholds

---

### 7. Redundant Latency Alerts: HighP99Latency vs HighP95Latency vs CriticalP95Latency

**Rules:** `HighP99Latency` (alert #3), `HighP95Latency` (alert #12), `CriticalP95Latency` (alert #13)

**Observation:**

Alert #3 (niffyinsure_api):
```yaml
- alert: HighP99Latency
  expr: |
    histogram_quantile(0.99,
      sum(rate(http_request_duration_seconds_bucket{app="niffyinsure-api"}[10m]))
      by (le)
    ) > 3
  for: 10m
  labels:
    severity: warning
```

Alert #12 (niffyinsure_http_sla):
```yaml
- alert: HighP95Latency
  expr: job:http_request_duration_seconds:p95_5m > 1
  for: 5m
  labels:
    severity: warning
```

Alert #13 (niffyinsure_http_sla):
```yaml
- alert: CriticalP95Latency
  expr: job:http_request_duration_seconds:p95_5m > 3
  for: 2m
  labels:
    severity: critical
```

**Why flagged:**
- Three separate alerts on HTTP request latency
- Different percentiles (p99 vs p95)
- Different thresholds (3s vs 1s vs 3s)
- Different windows (10m vs 5m vs 5m, but via recording rule)
- Different durations (10m vs 5m vs 2m)
- HighP95Latency (alert #12) and CriticalP95Latency (alert #13) both use p95, but different thresholds (1s warning vs 3s critical)
- Potential cascade: if latency rises, alert #12 fires at p95>1s, then alert #13 fires at p95>3s
- Only alerts #12 and #13 have runbook links; alert #3 does not

**Next real review should:**
- Determine the true SLA: is it "warn at p95>1s" or "warn at p99>3s"?
- Consider consolidating to: (1) warning at p95>1s, (2) critical at p95>3s, removing the p99-based alert
- Clarify the semantics: does p99>3s matter if p95<1s is healthy (meaning only 1-in-100 requests are slow)?
- Add per-route granularity so operators can quickly identify which routes are slow

---

### 8. Missing Runbooks: High5xxRate, HighRpcErrorRate, HighP99Latency, and Others (niffyinsure_api group)

**Rules:** 11 alerts in the niffyinsure_api group

**Observation:**

All 11 alerts in the `niffyinsure_api` group lack `runbook_url` in their annotations:
- High5xxRate (#1)
- HighRpcErrorRate (#2)
- HighP99Latency (#3)
- HighRpcP95Latency (#4)
- IndexerLagHigh (#5)
- SolvencyBufferLow (#6)
- DlqDepthHigh (#7) — has inline guidance, but no external runbook link
- RedisCacheHitRateLow (#8)
- RedisConnectionErrors (#9)
- IndexerLedgerGapHigh (#10)
- IndexerLastLedgerAgeHigh (#11)

By contrast, all 4 alerts in the `niffyinsure_http_sla` and `niffyinsure_http_errors` groups (alerts #12–#15) DO have runbook links.

**Why flagged:**
- Operators alerted by a critical/warning alert are expected to have a runbook or troubleshooting guide
- Missing runbooks create context-switching delays and may lead to incorrect responses
- niffyinsure_api group has some of the most critical alerts (SolvencyBufferLow, IndexerLastLedgerAgeHigh) with no documented response path

**Next real review should:**
- For each alert lacking a runbook, determine if one exists (internal wiki, PR comments, verbal documentation)
- If runbook exists, add the link to the alert definition
- If no runbook exists, create one or backlog its creation before next quarter's review
- Consider templating runbooks for similar alert types (e.g., a generic "High Error Rate" runbook, a generic "Lag Detection" runbook)

---

### 9. Dynamic Threshold: SolvencyBufferLow (alert #6)

**Rule:** `SolvencyBufferLow` (niffyinsure_api group)

**Observation:**
```yaml
- alert: SolvencyBufferLow
  expr: |
    solvency_buffer_stroops{app="niffyinsure-api"} < solvency_buffer_threshold_stroops{app="niffyinsure-api"}
  for: 5m
  labels:
    severity: critical
```

**Why flagged:**
- Threshold is dynamic: `< solvency_buffer_threshold_stroops{app="niffyinsure-api"}`
- The actual threshold value is not visible in the rule definition; it comes from the metric value at query time
- Operators alerted by this rule may not immediately understand "what is the threshold?" without checking the metric directly in Prometheus
- No runbook to explain how to verify solvency or what corrective actions are available

**Next real review should:**
- Verify that the solvency_buffer_threshold_stroops metric is being emitted correctly and reflects the true safety threshold
- Consider adding a comment to the rule definition explaining what "buffer" means (treasury balance - approved obligations?)
- Confirm there's a runbook for solvency incidents (should be high priority, given critical severity)

---

## Summary of Flagged Items

| Issue | Count | Alert(s) | Severity |
|-------|:-----:|----------|----------|
| Missing runbook | 11 | #1–#11 (all niffyinsure_api) | High — operators lack guidance |
| Permissive threshold | 1 | #9 (RedisConnectionErrors: `>0`) | Medium — likely noisy |
| Unusual threshold | 1 | #8 (RedisCacheHitRateLow: <50%) | Low — may mask problems |
| High threshold (possible underfiring) | 1 | #4 (HighRpcP95Latency: >8s) | Medium — may miss degradation |
| Overlapping rules | 2 pairs | #1+#15 (5xx), #5+#10 (indexer lag) | Medium — redundant notifications |
| Redundant latency alerts | 3 way | #3, #12, #13 (various latency percentiles) | High — cascading alerts, unclear SLA |
| Dynamic/obscure threshold | 1 | #6 (SolvencyBufferLow) | Medium — lack of transparency |

---

## Next Steps

This preliminary pass is a static checklist for the first real review. The [Alert Fatigue Review Process](./alert-fatigue-review-process.md) should:

1. **Validate each flag** against actual Prometheus fire data for the review window (does the alert fire often?)
2. **Correlate with incidents** (does the alert fire for real problems, or noisy transients?)
3. **Decide on actions** (tune, consolidate, add runbook, remove) with the backend team
4. **Track resolution** in the [Findings Log](./alert-review-log.md)

Flags marked "likely noisy" (e.g., RedisConnectionErrors) should be high priority for the real review.

---

## Related Documents

- [Alert Inventory](./alert-inventory.md) — Full enumeration of all alert rules
- [Alert Fatigue Review Process](./alert-fatigue-review-process.md) — Methodology for real reviews
- [Alert Review Findings Log](./alert-review-log.md) — Template for recording review results
