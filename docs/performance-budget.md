# Performance Budget

This document defines the maximum acceptable performance thresholds for the
niff-Stellar-shurance platform. These budgets apply to all changes merged into
`main`. Any build or CI run that exceeds these thresholds must be justified and
either optimised or have the budget explicitly reviewed and updated.

> **Why a performance budget?**
> Keeping latency, bundle size, and indexer lag within known bounds ensures a
> consistent user experience, predictable resource usage, and healthy on-chain
> integration. Budgets are reviewed every quarter or when a new major feature
> ship.

---

## 1. API p95 Latency (per route)

All measurements are taken from production-like staging or production
infrastructure, excluding cold-start scenarios. "p95" means the 95th percentile
response time over a rolling 5-minute window.

| Route Area              | p95 Latency Budget | Notes                                           |
| ----------------------- | ------------------ | ----------------------------------------------- |
| Health / readiness      | < 200 ms           | No DB, no chain call                            |
| Authentication          | < 500 ms           | JWT generation, no external I/O                 |
| Quote / premium         | < 2 000 ms         | Includes Soroban simulation (budget-dependent)  |
| Policy CRUD             | < 1 000 ms         | Database reads/writes + optional chain call     |
| Claims list / detail    | < 1 000 ms         | Database reads + optional Soroban query         |
| Claim filing            | < 3 000 ms         | Includes Soroban submission + IPFS evidence     |
| Voting                  | < 2 000 ms         | Soroban + event indexing delay                  |
| Admin / governance      | < 2 000 ms         | Admin-only routes; may batch multiple writes    |
| Indexer health endpoint | < 200 ms           | Lightweight status check                        |
| GraphQL (nested)        | < 2 500 ms         | Nested policy → claim → evidence queries        |

### Escalation

If the p95 of any route exceeds its budget for two consecutive weeks, the owning
team opens a performance investigation ticket and either resolves the regression
or requests a budget revision.

---

## 2. Frontend JS Bundle Size

Budgets apply to the production client-side JS bundle (gzip-compressed) served
to browsers. Measurements are collected from the production Next.js build output
(`.next/analyze` or `next build` summary).

| Artifact          | Size Budget (gzip) | Notes                                   |
| ----------------- | ------------------ | --------------------------------------- |
| Initial JS (all)  | ≤ 180 KB           | First-load JS across all routes         |
| Per-route chunk   | ≤ 50 KB            | Route-based code-splitting chunk        |
| Vendor bundle     | ≤ 100 KB           | `react`, `next`, etc. shared libraries  |
| CSS (critical)    | ≤ 15 KB            | Inlined critical CSS                    |
| Wasm fallback JS  | ≤ 10 KB            | Stellar SDK loader (when applicable)    |

### Escalation

Any PR that increases the initial JS bundle by >10 % compared to the `main`
baseline must include a bundle analysis comment and either shrink the addition
or get an explicit exemption from the frontend lead.

---

## 3. Lighthouse Score

Lighthouse audits run against the production deployment every build using the
`lighthouse-ci` GitHub Action. Scores are based on the **Mobile** profile.

| Category           | Minimum Score | Notes                               |
| ------------------ | ------------- | ----------------------------------- |
| Performance        | ≥ 85          | Core Web Vitals                      |
| Accessibility      | ≥ 90          | a11y compliance                      |
| Best Practices     | ≥ 85          | Security & modern web standards      |
| SEO                | ≥ 90          | Meta tags, semantic HTML, crawlable  |
| PWA                | ≥ 50          | Offline support, manifest, SW        |

### Escalation

A PR that drops any category below the threshold should not be merged until the
regression is addressed or the budget is updated with documented reasoning.

---

## 4. Indexer Ledger Lag

The indexer processes Stellar ledger close events and writes them into the
application database. Ledger lag is the difference between the latest Stellar
ledger sequence and the last ledger sequence fully indexed.

| Metric                 | Budget          | Notes                                       |
| ---------------------- | --------------- | ------------------------------------------- |
| Steady-state lag       | ≤ 3 ledgers     | During normal operation, no back-pressure   |
| Catch-up lag (replay)  | ≤ 100 ledgers   | After an outage of < 30 minutes             |
| Maximum tolerated lag  | ≤ 300 ledgers   | Beyond this, alert triggers incident        |

### Monitoring

- Prometheus/Grafana dashboard exposes `indexer_ledger_lag` gauge.
- Alert fires when lag exceeds 100 ledgers for > 5 minutes.
- Critical alert (PagerDuty) fires when lag exceeds 300 ledgers.

### Escalation

If the lag exceeds the maximum tolerated threshold, an automatic incident is
created. The on-call engineer follows the [indexer runbook](../backend/docs/indexer-runbook.md)
to diagnose (back-pressure from chain RPC, database write contention, etc.).

---

## Review & Revision

This document is reviewed quarterly or when a significant architectural change
(change in chain, new indexer backend, major frontend framework upgrade) lands.

| Date       | Author            | Change Summary             |
| ---------- | ----------------- | -------------------------- |
| 2026-06-25 | Niffy InsurNiffy  | Initial performance budget |

---

## Related Documents

- [Observability](../backend/docs/observability.md)
- [Indexer Runbook](../backend/docs/indexer-runbook.md)
- [Grafana Dashboard](../backend/docs/grafana-dashboard.json)
- [Prometheus Alerts](../backend/docs/prometheus-alerts.yml)
