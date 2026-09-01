# Rate Limiting

All API endpoints are protected by a Redis-backed sliding-window rate limiter.
Limits are applied **per wallet address** when a valid JWT is present, or **per IP address** otherwise.
This means authenticated users behind a shared corporate NAT are not penalised collectively.

## Default Limits

| Endpoint group | Limit | Window |
|---|---|---|
| All endpoints (global default) | 120 requests | 60 seconds |
| `POST /api/auth/challenge` | 20 requests | 5 minutes |
| `POST /api/auth/verify` | 20 requests | 5 minutes |
| `POST /api/quote/generate-premium` | 20 requests | 60 seconds |
| `POST /api/ipfs/upload` | 10 requests | 60 seconds |
| `POST /api/claims/build-transaction` | 10 requests | 60 seconds |

> These are approximate values and may be tuned based on observed traffic patterns.
> Limits for claim submission (`POST /api/claims/submit`) are additionally governed by
> a per-policy ledger-window counter (see claim rate limiting docs).

## Appeal Submission Rate Limits (#1322)

`POST /api/claims/:id/appeal` (and related appeal write paths) use a **dedicated**
`AppealRateLimitGuard`, not the shared `ClaimRateLimitGuard`.

| Limit | Window | Rationale |
|---|---|---|
| 2 appeals | 1 hour | Appeals are rarer and higher-stakes than claim filing; a tight hourly cap blocks spray-and-pray appeal spam without touching claim budgets. |
| 5 appeals | 1 day | Isolates abuse from the claim-filing daily window (20/day). Legitimate claimants almost never need more than one appeal per claim. |

Redis keys are namespaced (`appeal:hour:…`, `appeal:day:…`) so they never share
counters with `claim:*` keys. Responses include `X-RateLimit-Policy: appeal`.

Environment variables:

| Variable | Default | Description |
|---|---|---|
| `MAX_APPEALS_PER_WALLET_PER_HOUR` | 2 | Appeals per wallet per hour |
| `MAX_APPEALS_PER_WALLET_PER_DAY` | 5 | Appeals per wallet per day |

Nest `@Throttle` on the appeal route (5 req / 60s) remains as a coarse IP/route
safety net on top of the wallet-scoped appeal guard.

## Claim Submission Rate Limits

Claim submission (`POST /api/claims/submit`) is protected by **three layers** of rate limiting:

1. **Global circuit breaker** — prevents system overload from any source.
2. **Per-wallet sliding window** — prevents a single wallet from flooding claims.
3. **Per-policy ledger window** — prevents spam against a single policy.

### Layer 1: Global Circuit Breaker

| Limit | Window | Rationale |
|---|---|---|
| 100 claims | 5 minutes | Protects governance capacity and DAO voter attention across all policies. If triggered, all claim submissions are rejected until the window slides. |

### Layer 2: Per-Wallet Sliding Window

| Limit | Window | Rationale |
|---|---|---|
| 3 claims | 1 hour | Prevents a single wallet from exhausting governance for a specific tenant or policy type. Aligns with typical legitimate catastrophic-event filing patterns (1–2 claims per hour). |

### Layer 3: Per-Policy Ledger Window

| Limit | Window | Rationale |
|---|---|---|
| 5 claims | 17,280 ledgers (~24h) | Prevents spam against an individual policy. Uses ledger-based windows to avoid clock-skew issues. |

### Claim Rate Limit Configuration

Environment variables:

| Variable | Default | Description |
|---|---|---|
| `GLOBAL_RATE_LIMIT` | 100 | Global claim submissions per window |
| `GLOBAL_RATE_LIMIT_WINDOW_SECONDS` | 300 | Global window in seconds |
| `WALLET_RATE_LIMIT` | 3 | Claims per wallet per window |
| `WALLET_RATE_LIMIT_WINDOW_SECONDS` | 3600 | Wallet window in seconds |
| `RATE_LIMIT_DEFAULTS.DEFAULT_LIMIT` | 5 | Per-policy claim limit |
| `RATE_LIMIT_DEFAULTS.WINDOW_SIZE_LEDGERS` | 17280 | Per-policy window in ledgers |

All values are stored in Redis and survive service restarts.

## Response Headers

Every response includes:

```
X-RateLimit-Limit: <limit>
X-RateLimit-Remaining: <remaining>
X-RateLimit-Reset: <unix timestamp>
```

When a limit is exceeded, the API returns **HTTP 429 Too Many Requests** with:

```
Retry-After: <seconds until window resets>
```

```json
{
  "statusCode": 429,
  "message": "ThrottlerException: Too Many Requests"
}
```

## CDN / WAF Coordination

If a CDN or WAF sits in front of the API, ensure it forwards the real client IP via
`X-Forwarded-For`. The backend trusts the first value in that header.
Avoid double-counting at the CDN layer for the same limits — either enforce at CDN
**or** at the API, not both, to prevent false positives for large NATs.

## Ops Monitoring

Throttle hits are logged as structured `WARN` entries under the `ThrottleHit` logger:

```json
{
  "level": "warn",
  "message": "Throttle limit hit",
  "tracker": "wallet:GABC...",
  "key": "default",
  "totalHits": 121,
  "limit": 120,
  "retryAfterSec": 42,
  "method": "POST",
  "path": "/api/quote/generate-premium"
}
```

Alert on sustained `ThrottleHit` volume from a single tracker to detect abuse patterns.
