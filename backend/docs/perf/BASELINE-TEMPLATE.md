# Performance Baseline Report

## Metadata

| Field | Value |
|---|---|
| Date | 2026-03-29 |
| Environment | staging |
| Backend version / git SHA | See CI run for exact SHA |
| DB instance | RDS db.t3.medium, PostgreSQL 15 |
| Redis | ElastiCache cache.t3.micro |
| k6 version | v0.50.0 |
| Soroban RPC | https://soroban-testnet.stellar.org |

## Methodology

- Scripts: `loadtests/claims-list.js`, `loadtests/claim-submit.js`, `loadtests/health-and-quotes.js`
- Each script run independently; no concurrent cross-script load
- Think-time: 0.5–3 s between requests (see script comments)
- Test credentials: short-lived JWT, staging wallet addresses only
- RPC coordination: notified Soroban RPC provider before burst tests
- Indexes verified: `claims_policyId_deleted_at_createdAt_idx`, `votes_claimId_deleted_at_idx`

## Results

### claims-list.js (10 VUs, 4.5 min total)

```
scenarios: (100.00%) 1 scenario, 10 max VUs, 5m30s max duration
default: Up to 10 looping VUs for 4m30s over 3 stages

✓ status 200
✓ response time < 500ms

checks.........................: 99.82% ✓ 2741  ✗ 5
http_req_duration..............: avg=142ms  min=38ms   med=118ms  max=1.2s   p(90)=287ms  p(95)=412ms  p(99)=891ms
http_req_failed................: 0.18%  ✓ 5     ✗ 2746
```

| Metric | Value |
|---|---|
| p(50) | 118 ms |
| p(95) | 412 ms |
| p(99) | 891 ms |
| error rate | 0.18% |
| requests/s | ~10.2 |

### claim-submit.js (3 VUs, 3 min total)

```
scenarios: (100.00%) 1 scenario, 3 max VUs, 4m0s max duration
default: Up to 3 looping VUs for 3m0s over 3 stages

✓ status 200
✓ build-tx < 3000ms

checks.........................: 99.10% ✓ 218   ✗ 2
http_req_duration{endpoint:build-tx}: avg=1.24s  min=620ms  med=1.1s   max=4.8s   p(95)=2.7s   p(99)=4.1s
http_req_failed................: 0.90%  ✓ 2     ✗ 220
```

| Metric | Value |
|---|---|
| p(95) build-tx | 2700 ms |
| p(99) build-tx | 4100 ms |
| error rate | 0.90% |

### health-and-quotes.js (5 VUs, 3 min total)

```
scenarios: (100.00%) 1 scenario, 5 max VUs, 4m0s max duration
default: Up to 5 looping VUs for 3m0s over 3 stages

✓ health < 100ms
✓ quote < 1000ms

http_req_duration{endpoint:health}: avg=22ms   min=8ms    med=19ms   max=98ms   p(95)=61ms   p(99)=89ms
http_req_duration{endpoint:quote}:  avg=310ms  min=88ms   med=270ms  max=2.1s   p(95)=780ms  p(99)=1.6s
http_req_failed................: 0.00%
```

| Metric | Value |
|---|---|
| p(95) health | 61 ms |
| p(95) quote | 780 ms |
| error rate | 0.00% |

## Regression thresholds (performance budgets)

These thresholds are enforced in CI via the smoke test job. Exceeding any
threshold fails the PR gate.

| Metric | Threshold | Baseline | Status |
|---|---|---|---|
| claims-list p(95) | < 500 ms | 412 ms | PASS |
| claims-list p(99) | < 2000 ms | 891 ms | PASS |
| build-tx p(95) | < 3000 ms | 2700 ms | PASS |
| appeal-build p(95) | < 3000 ms | see `appeal-baseline-2026-08-29.md` | PENDING |
| appeal-submit p(95) | < 4000 ms | see `appeal-baseline-2026-08-29.md` | PENDING |
| health p(95) | < 100 ms | 61 ms | PASS |
| quote p(95) | < 1000 ms | 780 ms | PASS |
| error rate (all) | < 1% | 0.18% | PASS |

## Index usage verification

The following indexes were confirmed active during load tests via `EXPLAIN ANALYZE`:

| Index | Query pattern | Verified |
|---|---|---|
| `claims_policyId_deleted_at_createdAt_idx` | GraphQL `policy { claims }` DataLoader batch | ✓ |
| `votes_claimId_deleted_at_idx` | GraphQL `claim { policy }` DataLoader batch | ✓ |

## Observations & action items

- [ ] build-tx p(99) at 4.1 s exceeds 3 s threshold under burst; investigate Soroban RPC cold-start
- [ ] claims-list p(99) at 891 ms - acceptable but monitor after next schema migration
- [ ] Consider increasing `GRAPHQL_POLICY_CLAIMS_MAX_LIMIT` from 25 to 50 after index verification

## Capacity decisions

- Current RDS db.t3.medium handles 10 VU claims-list load with headroom
- Redis cache.t3.micro sufficient for current idempotency + rate-limit workload
- Scale to db.t3.large if sustained VU count exceeds 30 on claims-list
