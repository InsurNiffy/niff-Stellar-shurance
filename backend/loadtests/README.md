# Load Tests — NiffyInsure Backend

k6 scripts for performance baseline measurement and regression detection.

## Safety rules

- **Never run against production.** Target staging only.
- Coordinate with Soroban RPC providers before any burst > 50 VUs.
- Use short-lived test credentials (see "Credentials" below).
- All scripts include realistic think-time (`sleep`) between requests.

## Prerequisites

```bash
# Install k6 (https://k6.io/docs/get-started/installation/)
# macOS
brew install k6
# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

## Credentials

Load tests use short-lived JWT tokens scoped to test wallet addresses.
**Never use real user credentials or production admin tokens.**

Generate a test token:

```bash
# Staging only — uses the staging JWT_SECRET
node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { sub: 'GTEST000000000000000000000000000000000000000000000000000001', role: 'user' },
  process.env.STAGING_JWT_SECRET,
  { expiresIn: '1h', issuer: 'niffyinsure', audience: 'niffyinsure-api' }
);
console.log(token);
"
```

Store the token in a CI vault secret (`STAGING_TEST_JWT`) and pass it via
environment variable — never hardcode tokens in scripts.

## Running locally

```bash
# Read-heavy baseline (claims list)
BASE_URL=https://staging.niffyinsur.com \
  k6 run loadtests/claims-list.js

# GraphQL nested policy -> claims baseline
BASE_URL=https://staging.niffyinsur.com/api \
  k6 run loadtests/graphql-policy-claim-nested.js

# Authenticated write flow (claim submission)
BASE_URL=https://staging.niffyinsur.com \
TEST_JWT=<token> \
  k6 run loadtests/claim-submit.js

# Full smoke test (quick sanity check)
BASE_URL=https://staging.niffyinsur.com \
  k6 run --vus 2 --duration 30s loadtests/smoke.js
```

## Regression thresholds

| Metric | Threshold | Action if breached |
|---|---|---|
| `http_req_duration{p(95)}` | < 500 ms | Engineering ticket, investigate query plan |
| `http_req_duration{p(99)}` | < 2000 ms | Engineering ticket |
| `http_req_failed` | < 1% | Immediate investigation |
| `checks` pass rate | > 99% | Engineering ticket |

Thresholds are enforced in each script's `thresholds` block. k6 exits with
code 99 when a threshold is breached, which fails the CI job.

## Reports

Dated reports are stored in `docs/perf/`. Each report includes:
- Environment (staging URL, DB instance size, Redis config)
- Date and methodology
- k6 summary output
- Baseline numbers and any regressions vs previous run

Re-run after:
- Major DB schema changes or new indexes
- GraphQL schema / DataLoader changes
- NestJS / Prisma upgrades
- Soroban RPC client refactors
- Connection pool or cache TTL changes
