# Performance Baseline — Appeal endpoints (#1353)

## Metadata

| Field | Value |
|---|---|
| Date | 2026-08-29 |
| Environment | staging (record actual URL on first run) |
| Script | `loadtests/appeal-flow.js` |
| Backend version / git SHA | Record at run time |
| DB instance | RDS db.t3.medium, PostgreSQL 15+ |
| Redis | ElastiCache cache.t3.micro |
| k6 version | v0.50.0+ |
| Soroban RPC | staging / testnet endpoint |
| Feature flag | `claims_appeal_enabled=true` |
| Notes | Build path exercises `simulate_transaction`. Default submit uses invalid XDR to avoid on-chain spam; set `APPEAL_SUBMIT=1` only with pre-signed staging envelopes. |

## Methodology

- Stages: 0→5 VU / 30s, 5 VU / 2m, ramp down 30s (burst after batch rejects)
- Think-time: 1–3 s between build and submit
- Credentials: short-lived staging JWT; `APPEAL_CLAIM_IDS` = rejected staging claims
- Never against production

## Recorded baseline thresholds (regression gate)

| Metric | Threshold | Baseline (first staging run) | Status |
|---|---|---|---|
| `http_req_duration{endpoint:appeal-build}` p(95) | < 3000 ms | _TBD — fill after first staging run_ | PENDING |
| `http_req_duration{endpoint:appeal-build}` p(99) | < 8000 ms | _TBD_ | PENDING |
| `http_req_duration{endpoint:appeal-submit}` p(95) | < 4000 ms | _TBD_ | PENDING |
| `http_req_duration{endpoint:appeal-submit}` p(99) | < 10000 ms | _TBD_ | PENDING |
| `http_req_failed` | < 2% | _TBD_ | PENDING |
| `checks` pass rate | > 98% | _TBD_ | PENDING |

These thresholds are enforced in `appeal-flow.js` `options.thresholds`. k6 exit
code 99 on breach fails CI / manual regression runs.

## Example command

```bash
BASE_URL=https://staging.niffyinsur.com/api \
TEST_JWT=$STAGING_TEST_JWT \
APPEAL_CLAIM_IDS=101,102,103 \
k6 run backend/loadtests/appeal-flow.js
```

Paste k6 summary output below after the first official staging run and update
the Baseline column above.

## k6 summary (paste)

```
(run pending)
```

## Observations

- [ ] Compare appeal-build p(95) to claim-submit build-tx baseline (~2700 ms)
- [ ] Watch Soroban RPC error rate during 5 VU sustained
- [ ] Confirm rate limits (build 10/min, submit 5/min per controller throttles) do not dominate failures
