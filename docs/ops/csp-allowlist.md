# CSP Allowlist — Operator Checklist

**Enforced in:** `frontend/src/middleware.ts` (per-request nonce, runs on every route)  
**Static fallback:** `frontend/next.config.mjs` `headers()` (no nonce — CDN/static export only)  
**CI check:** `.github/workflows/csp-allowlist-drift.yml` — fails when code and this doc diverge  
**Review cadence:** On every RPC vendor change, wallet SDK upgrade, new third-party integration, or quarterly whichever comes first.

---

## Hardening Requirements (issue #1696)

These invariants are enforced by `npm run check-csp` and must hold in **both** `middleware.ts` and `next.config.mjs`:

- `script-src` MUST NOT contain `'unsafe-eval'` or `'unsafe-inline'`. Inline scripts are allowed only via `'nonce-{per-request}'` (middleware) or a hash-based approach (static export).
- `connect-src` is restricted to the known API, IPFS gateway, and Stellar RPC/Horizon endpoints listed below — no wildcards, no arbitrary origins.
- `require-trusted-types-for 'script'` MUST be present (with `trusted-types default` where supported) to block DOM-XSS sinks.
- A `Report-To` header MUST point to the security reporting endpoint (`$CSP_REPORT_URI`), with `report-uri`/`report-to` in the policy as fallback.

---

## IPFS Gateway Allowlist (issue #1697)

The on-chain `GatewayAllowlist` storage key is the source of truth for which IPFS gateways may serve claim evidence. The backend validates every evidence URL against it via `IpfsGatewayValidator` (`backend/src/ipfs/`); URLs whose host is not in the allowlist are rejected with **HTTP 400** at the API boundary.

- The CSP `connect-src` IPFS entries below MUST be a subset of the on-chain `GatewayAllowlist` — a gateway the browser is allowed to fetch from but the backend rejects (or vice-versa) is a misconfiguration.
- When adding or removing a gateway, update the on-chain `GatewayAllowlist` **and** the `connect-src` entries in both `middleware.ts` and `next.config.mjs`, then update the table below.
- `https://ipfs.io` is the default gateway and must remain in the allowlist unless `NEXT_PUBLIC_IPFS_GATEWAY` is set for all deployments.

---

## Current Allowlist

Both `middleware.ts` and `next.config.mjs` must be kept in sync. The CI check (`npm run check-csp`) enforces this automatically on every PR that touches either file.

### `script-src`

| Source | Purpose | Condition |
|---|---|---|
| `'self'` | App JS bundles | Always |
| `'nonce-{per-request}'` | Next.js inline bootstrapper (`__NEXT_DATA__`, chunk loader) | Always |
| `https://plausible.io` | Plausible analytics script (cloud-hosted default) | `NEXT_PUBLIC_ANALYTICS_ENABLED=true` only |

`'unsafe-eval'` and `'unsafe-inline'` are **not permitted** in `script-src`.  
Freighter and xBull inject via **browser extension content scripts**, which run outside the page CSP entirely — no `script-src` entry is required for them.  
Ref: [Freighter CSP docs](https://docs.freighter.app/docs/guide/csp) · [xBull CSP docs](https://docs.xbull.app/integration/csp)

If `NEXT_PUBLIC_ANALYTICS_SRC` is set to a self-hosted Plausible URL, that origin replaces `https://plausible.io` in both `script-src` and `connect-src`.

### `connect-src` — XHR / fetch / WebSocket

Restricted to the known API, IPFS gateway, and Stellar RPC/Horizon endpoints below. Any new origin requires the checklist below and a CI-passing update to both files.

| Host | Purpose | Condition |
|---|---|---|
| `'self'` | Same-origin API calls | Always |
| `$NEXT_PUBLIC_API_URL` (origin only) | Backend REST API | Always |
| `https://plausible.io` | Plausible event ingestion (`/api/event`) | `NEXT_PUBLIC_ANALYTICS_ENABLED=true` only |
| `https://soroban-testnet.stellar.org` | Soroban RPC — testnet | Required for testnet |
| `https://horizon-testnet.stellar.org` | Horizon REST — testnet | Required for testnet |
| `wss://soroban-testnet.stellar.org` | Soroban event streaming — testnet | Required for testnet |
| `https://soroban.stellar.org` | Soroban RPC — mainnet | Required for mainnet |
| `https://horizon.stellar.org` | Horizon REST — mainnet | Required for mainnet |
| `wss://soroban.stellar.org` | Soroban event streaming — mainnet | Required for mainnet |
| `https://stellar.expert` | Block explorer links (`explorerUrl()`) | UX only — removable if explorer links are dropped |
| `https://ipfs.io` | IPFS gateway for claim evidence CID retrieval | Default when `NEXT_PUBLIC_IPFS_GATEWAY` is unset; must be in on-chain `GatewayAllowlist` |
| `$NEXT_PUBLIC_IPFS_GATEWAY` (origin only) | Configured IPFS gateway (e.g. `https://gateway.pinata.cloud`) | When `NEXT_PUBLIC_IPFS_GATEWAY` is set; must be in on-chain `GatewayAllowlist` |
| `$RAMP_URL` (origin only) | Fiat on-ramp integration | `NEXT_PUBLIC_RAMP_ENABLED=true` only |

### `require-trusted-types-for` / `trusted-types`

`require-trusted-types-for 'script'` is set on every response. `trusted-types default` restricts policy creation to the app's own default policy. Any DOM sink (`innerHTML`, `eval`, `script.src`) must go through a Trusted Types policy.

### `Report-To` / `report-uri`

A `Report-To` response header points to the security reporting endpoint (`$CSP_REPORT_URI`, e.g. `https://security.example.com/csp-report`). The policy also carries `report-uri`/`report-to` so violations are collected even where `Report-To` is unsupported.

### `style-src`

`'unsafe-inline'` is currently required because Tailwind CSS injects utility classes at runtime.  
**TODO(csp-style-nonce):** Migrate to build-time CSS extraction (`output: 'export'` or a PostCSS pipeline) to remove `'unsafe-inline'` and replace with a style nonce.

### `img-src`

| Source | Purpose |
|---|---|
| `'self'` | App images |
| `data:` | Next/Image blur placeholders |
| `blob:` | Client-side image previews (evidence upload) |

### `font-src`

`'self'` only. Inter and IBM Plex Mono are self-hosted via `next/font` — no external font CDN.

### `frame-src`, `frame-ancestors`, `object-src`

All set to `'none'`. Wallet popups (Freighter, xBull) open as top-level windows, not iframes.

---

## Removed / stale entries

The following entries were present in earlier versions and have been removed:

| Entry | Reason removed |
|---|---|
| `https://cdn.freighter.app` (script-src) | Freighter injects via extension content scripts — no page-level script-src entry needed. Ref: [Freighter CSP docs](https://docs.freighter.app/docs/guide/csp) |
| `https://xbull.app` (script-src) | Same as above for xBull. Ref: [xBull CSP docs](https://docs.xbull.app/integration/csp) |
| `'unsafe-eval'` (script-src) | Removed per #1696 — no code path requires eval; blocks eval-based XSS. |
| `'unsafe-inline'` (script-src) | Removed per #1696 — inline scripts use per-request nonce instead. |

---

## Checklist: Adding a New Third-Party Service

1. Identify the full origin (scheme + host, no path): e.g. `https://rpc.example.com`
2. Determine which directive(s) it needs (`script-src`, `connect-src`, `img-src`, etc.).
3. Add it to **both** locations:
   - `frontend/src/middleware.ts` → `buildCsp()` — the relevant directive array
   - `frontend/next.config.mjs` → `buildCsp()` — the same directive array (static fallback)
4. If the endpoint uses WebSockets, add the `wss://` origin too.
5. Add a comment with the purpose and a link to the vendor's CSP guidance.
6. Add a row to the allowlist table above.
7. Run `npm run check-csp` locally to confirm no drift.
8. Deploy to staging → run all wallet flows (Freighter + xBull) → check browser console for CSP violations.
9. Open a PR; second engineer reviews before merge.

## Checklist: Adding a New IPFS Gateway

1. Add the gateway origin to the on-chain `GatewayAllowlist` (contract admin call).
2. Add the same origin to `connect-src` in both `middleware.ts` and `next.config.mjs`.
3. Add a row to the `connect-src` table above.
4. Confirm `IpfsGatewayValidator` accepts evidence URLs for the new gateway (backend returns 400 for non-allowlisted hosts).
5. Run `npm run check-csp` locally.

## Checklist: Removing a Third-Party Service

1. Confirm no code path still calls the host:
   ```bash
   grep -r "rpc.example.com" frontend/src
   ```
2. Remove from both `middleware.ts` and `next.config.mjs`.
3. Move the entry to the "Removed / stale entries" table above with the reason.
4. Run `npm run check-csp` locally.
5. Test in staging.

## Checklist: Adding a New Wallet

1. Check the wallet's CSP documentation.
2. If it requires a `script-src` entry (unlikely for extension-based wallets), add it with a comment linking to the vendor docs.
3. If it opens an iframe (e.g. WalletConnect modal), add the iframe origin to `frame-src` and document why.
4. Test the full connect → sign → submit flow in staging.
5. Update this document.

---

## CI Check

`npm run check-csp` (runs `scripts/check-csp-allowlist.mjs`) parses all `https://` and `wss://` origins from `middleware.ts` and `next.config.mjs` and cross-references them against this document.

- **Undocumented origin in code** → hard failure (exit 1). Add it to the allowlist table above.
- **Documented origin not in code** → warning. Either remove the stale entry from this doc or re-add it to the code.
- **`'unsafe-eval'` or `'unsafe-inline'` in `script-src`** → hard failure (issue #1696).
- **Missing `require-trusted-types-for 'script'`** → hard failure (issue #1696).
- **Missing `Report-To` header** → hard failure (issue #1696)
