# Multi-Region Deployment Guide

**Owner:** Platform Engineering  
**Applies to:** Backend API, Frontend (Next.js), Soroban contract RPC calls  
**Review cadence:** After every major infrastructure change or Horizon endpoint migration

---

## Overview

InsurNiffy's architecture has three tiers with distinct latency concerns across regions:

| Tier | What it does | Latency-critical? |
|---|---|---|
| Frontend (Next.js / CDN) | Serves static assets and SSR pages | Yes — user-facing |
| Backend API (NestJS) | REST + WebSocket, Prisma → PostgreSQL, BullMQ | Yes — drives claims UX |
| Soroban RPC | Reads ledger state, submits transactions | Yes — blockchain finality |

Regional deployments should co-locate the backend and its RPC endpoint in the same cloud region to avoid cross-region latency on every contract call.

---

## RPC Endpoint Selection by Region

### Stellar Mainnet

| Cloud region | Recommended RPC endpoint | Operator | Notes |
|---|---|---|---|
| US East (us-east-1 / us-central1) | `https://mainnet.stellar.validationcloud.io/v1/<KEY>` | Validation Cloud | Lowest RTT from US East PoPs |
| EU West (eu-west-1 / europe-west1) | `https://rpc.stellar.org` | SDF | SDF PoP in EU; fallback to Blockdaemon EU |
| AP Southeast (ap-southeast-1) | `https://horizon.stellar.org` via Horizon+Soroban bridge | SDF | Dedicated Soroban RPC scarce in APAC; use SDF as primary |
| Self-hosted | Deploy `stellar/quickstart` with `--enable-soroban-rpc` | Internal | Requires 500 GB+ SSD for archival node; only for latency-critical prod |

**How to configure:** Set `SOROBAN_RPC_URL` in the backend `.env` per deployment environment. The value is consumed by [`backend/src/stellar/stellar.service.ts`](../../backend/src/stellar/stellar.service.ts).

```
# US East
SOROBAN_RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<KEY>
STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015

# EU West (fallback to SDF)
SOROBAN_RPC_URL=https://rpc.stellar.org
```

### Stellar Testnet

Always use the SDF testnet RPC regardless of region — there is only one testnet:

```
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

---

## Expected Latency for Soroban Calls

Measured from backend to RPC endpoint (p50 / p99):

| Call type | Typical latency | Notes |
|---|---|---|
| `getLatestLedger` | 80–150 ms / 300 ms | Read-only; cache aggressively (TTL 5 s) |
| `getLedgerEntries` (policy/claim state) | 100–250 ms / 500 ms | Per-key lookup; batch where possible |
| `simulateTransaction` | 200–400 ms / 800 ms | CPU-bound on the RPC node; avoid on hot paths |
| `sendTransaction` | 150–300 ms / 600 ms | Network write; does not wait for finality |
| Ledger close (finality confirmation) | 5–8 s | Poll `getTransaction` at 1 s intervals up to 30 s |

**Reducing latency:**
- Cache `getLatestLedger` in Redis with a 5-second TTL; most reads do not need the absolute latest ledger.
- Use `getLedgerEntries` in bulk — a single request for 10 keys costs the same RTT as one key.
- Never call `simulateTransaction` in a user-facing request path; move simulation to the frontend or a background worker.
- For high-throughput paths (e.g. the claim-events indexer), open a persistent WebSocket to the RPC node instead of polling REST.

---

## Database Placement

PostgreSQL must be in the same availability zone as the backend. Cross-AZ Postgres adds 1–5 ms per query, which compounds across complex joins in the claims flow.

| Deployment target | Recommended DB placement |
|---|---|
| AWS | RDS in the same AZ as the ECS task / EC2 instance |
| GCP | Cloud SQL with a private IP in the same VPC region as Cloud Run |
| Fly.io | Fly Postgres volume in the same `fly.toml` region |
| Railway | Railway Postgres in the same project region |

---

## CDN Configuration for the Frontend

The Next.js frontend emits three output classes with different caching strategies:

| Output class | Cache-Control | CDN TTL | Notes |
|---|---|---|---|
| `/_next/static/**` | `public, max-age=31536000, immutable` | 1 year | Content-hashed filenames; safe to cache forever |
| `/` and page routes (SSR) | `s-maxage=30, stale-while-revalidate=60` | 30 s | Dynamic data; allow short CDN cache + background revalidate |
| `/api/**` (Next.js API routes, if used) | `no-store` | 0 | Never cache API responses at CDN |
| WebSocket upgrade (`/socket.io`) | — | — | Pass through to backend; do not terminate at CDN |

### Cloudflare

```toml
# wrangler.toml / page rules
[[rules]]
match = "/_next/static/*"
cache = { mode = "cache_everything", browser_ttl = 31536000, edge_ttl = 31536000 }

[[rules]]
match = "/api/*"
cache = { mode = "bypass" }
```

### Vercel (recommended for Next.js)

Vercel applies the `Cache-Control` headers set in `next.config.js` automatically. No additional CDN rule required for static assets. Ensure `output: 'standalone'` is **not** set if deploying to Vercel's edge network (use default mode).

```js
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};
```

### AWS CloudFront

Create two cache behaviors:

1. `/_next/static/*` → CachingOptimized managed policy (TTL 86400 s default, 31536000 s max).
2. `/*` → CachingDisabled managed policy for SSR pages, then set `Cache-Control` at the origin (Next.js) to `s-maxage=30`.

---

## Health Checks and Failover

Each region must expose `/healthz` on the backend (already implemented in [`backend/src/health/health.controller.ts`](../../backend/src/health/health.controller.ts)). Configure your load balancer to:

- Poll `/healthz` every 10 s with a 5 s timeout.
- Mark unhealthy after 2 consecutive failures.
- Restore after 3 consecutive successes.

For active-active multi-region: route writes (transaction submission) to the region closest to the user. Reads can fan out to any region with a replicated Postgres read replica.

For active-passive (simpler): use DNS failover (Route 53 / Cloudflare). Primary region handles all traffic; secondary is warm-standby with Postgres replica promoted on failover (see [`disaster-recovery-runbook.md`](./disaster-recovery-runbook.md)).

---

## Environment Variable Checklist per Region

| Variable | Value per region | Source |
|---|---|---|
| `SOROBAN_RPC_URL` | Region-nearest RPC endpoint | See table above |
| `DATABASE_URL` | Region-local Postgres | Infra secrets |
| `REDIS_HOST` / `REDIS_PORT` | Region-local Redis | Infra secrets |
| `STELLAR_NETWORK_PASSPHRASE` | Network-specific passphrase | `.env.example` |
| `NEXT_PUBLIC_API_URL` | Region-local backend URL | Build-time |
| `CORS_ORIGIN` | Frontend origin for that region | Backend env |

Store secrets in your cloud provider's secret manager (AWS Secrets Manager, GCP Secret Manager, Doppler) and inject them at deploy time — never commit region-specific values to the repository.
