# Performance Baseline Report

## Metadata

| Field | Value |
|---|---|
| Date | YYYY-MM-DD |
| Environment | staging |
| Backend version / git SHA | |
| DB instance | e.g. RDS db.t3.medium, PostgreSQL 15 |
| Redis | e.g. ElastiCache cache.t3.micro |
| k6 version | `k6 version` output |
| Soroban RPC | https://soroban-testnet.stellar.org |

## Methodology

- Scripts: `loadtests/claims-list.js`, `loadtests/claim-submit.js`, `loadtests/health-and-quotes.js`
- Each script run independently; no concurrent cross-script load
- Think-time: 0.5–3 s between requests (see script comments)
- Test credentials: short-lived JWT, staging wallet addresses only
- RPC coordination: notified Soroban RPC provider before burst tests

## Results

### claims-list.js (10 VUs, 4.5 min total)

```
scenarios: (100.00%) 1 scenario, 10 max VUs
...paste k6 summary output here...
```

| Metric | Value |
|---|---|
| p(50) | |
| p(95) | |
| p(99) | |
| error rate | |
| requests/s | |

### claim-submit.js (3 VUs, 3 min total)

```
...paste k6 summary output here...
```

| Metric | Value |
|---|---|
| p(95) build-tx | |
| p(99) build-tx | |
| error rate | |

### health-and-quotes.js (5 VUs, 3 min total)

```
...paste k6 summary output here...
```

| Metric | Value |
|---|---|
| p(95) health | |
| p(95) quote | |
| error rate | |

## Regression thresholds

| Metric | Threshold | Status |
|---|---|---|
| claims-list p(95) | < 500 ms | PASS / FAIL |
| claims-list p(99) | < 2000 ms | PASS / FAIL |
| build-tx p(95) | < 3000 ms | PASS / FAIL |
| health p(95) | < 100 ms | PASS / FAIL |
| error rate | < 1% | PASS / FAIL |

## Observations & action items

- [ ] Any hotspots identified?
- [ ] Index changes needed?
- [ ] Cache TTL adjustments?
- [ ] Connection pool tuning?

## Capacity decisions

Document any instance sizing or pool limit decisions made based on these results.
