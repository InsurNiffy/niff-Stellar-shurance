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
| `https://ipfs.io` | IPFS gateway for claim evidence CID retrieval | Default when `NEXT_PUBLIC_IPFS_GATEWAY` is unset |
| `$NEXT_PUBLIC_IPFS_GATEWAY` (origin only) | Configured IPFS gateway (e.g. `https://gateway.pinata.cloud`) | When `NEXT_PUBLIC_IPFS_GATEWAY` is set |
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
- **Missing `Report-To` header** → hard failure (issue #1696).

The check runs automatically on every PR that touches `frontend/src/middleware.ts`, `frontend/next.config.mjs`, or `docs/ops/csp-allowlist.md`.

---

## Report-Only Mode (Iteration Workflow)

Set in `.env.local` (never commit):

```
CSP_REPORT_ONLY=true
CSP_REPORT_URI=https://your-collector.example.com/csp-report
```

1. Deploy with `CSP_REPORT_ONLY=true`.
2. Run all wallet flows (quote → policy initiation → vote) in staging.
3. Collect violation reports from `CSP_REPORT_URI` or browser DevTools console.
4. For each violation:
   - If the blocked resource is legitimate → add to allowlist per checklist above.
   - If the blocked resource is unexpected → investigate as potential XSS/injection.
5. When violation reports are empty (or all explained), set `CSP_REPORT_ONLY=false` to enforce.

---

## Self-Hosting Implications

If you run your own Soroban RPC or Horizon node:

1. Replace the SDF-hosted origins with your own in `middleware.ts` and `next.config.mjs`.
2. If your node is on a non-standard port, include it: `https://rpc.internal.example.com:8080`.
3. If you use a CDN in front of the frontend (CloudFront, Cloudflare), verify the CDN forwards the `Content-Security-Policy` and `Report-To` response headers unchanged. Some CDNs strip or merge security headers.
4. If you use a static export (`next export`), middleware does not run — the static `headers()` in `next.config.mjs` is your only CSP. In that case, nonces are unavailable and you must use a hash-based approach for scripts (never `'unsafe-inline'`). Document this trade-off in your deployment runbook.

---

## Violation Triage Guide

| Violation directive | Likely cause | Action |
|---|---|---|
| `script-src` | Third-party script injected without nonce | Investigate source; add nonce or remove script |
| `connect-src` | New RPC/API/analytics endpoint not in allowlist | Add per checklist above |
| `style-src` | Dynamic style injection by a UI library | Add nonce to style or accept `unsafe-inline` with justification |
| `frame-src` | Wallet or embed opened in iframe | Add iframe origin to `frame-src` with justification |
| `require-trusted-types-for` | DOM sink (`innerHTML`, `eval`) not using a Trusted Types policy | Route the sink through the default policy |
