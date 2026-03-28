# Claim Status Notification Latency

## Overview

This document describes the expected end-to-end latency between an on-chain
claim status change and a user receiving a browser notification or in-app toast.

---

## Latency Budget (Mainnet)

| Stage | Typical | Worst-case |
|---|---|---|
| Ledger close (Stellar Mainnet) | ~5 s | ~10 s |
| Indexer ingestion lag | 1–3 ledgers (~5–15 s) | ~30 s during re-index |
| Backend cache TTL (`CACHE_TTL_SECONDS`) | 0–60 s | 60 s |
| Frontend polling interval (base) | 15 s | 60 s (after 2 failures) |
| **Total (polling path)** | **~35 s** | **~150 s** |
| SSE push delay (when SSE is active) | < 1 s after indexer ingestion | ~30 s |
| **Total (SSE path)** | **~20 s** | **~60 s** |

> **Agreed maximum latency (SLO):** status changes surface within **2 minutes**
> under normal operating conditions on Mainnet.

---

## Polling vs SSE

- The frontend attempts an SSE connection to `GET /api/claims/status/stream`
  first (`useRealtimeTallies` for tallies; `useClaimWatcher` for status).
- If SSE is unavailable or errors, the client falls back to polling
  `GET /api/claims/status` with exponential backoff (base 15 s, cap 60 s).
- Polling is **paused** when `document.visibilityState === "hidden"` (Page
  Visibility API) to reduce battery drain on mobile browsers.
- Polling resumes immediately when the tab becomes visible again.

---

## Battery Impact

- Base polling interval is 15 s (vs 5 s for tally updates) to reduce wake-ups.
- Backoff caps at 60 s after consecutive failures — no tight retry loops.
- Tab-hidden pause eliminates background polling entirely on mobile.
- SSE keeps a single persistent connection instead of repeated HTTP requests;
  a 25 s heartbeat comment keeps it alive through proxies without extra data.

---

## Indexer Lag

The backend indexer may lag behind the chain by 1–3 ledgers (~5–15 s) under
normal conditions. During re-indexing or RPC downtime this can extend to ~30 s.
The `ConsistencyMetadataDto.isStale` flag is set when `indexerLag > 5 ledgers`.

For trust-critical views (e.g. claim detail page), use chain reads via Soroban
simulation which always reflect the current ledger state.

---

## Multi-instance Deployment Note

The current SSE implementation uses an in-process listener registry
(`ClaimsService.statusListeners`). In a multi-instance deployment, replace this
with a Redis pub/sub channel so all instances can push to all connected clients.
See `backend/src/claims/claims.service.ts` — `subscribeToStatusChanges`.
