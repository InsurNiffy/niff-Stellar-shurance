# CSP Allowlist — Operator Checklist

**File:** `frontend/src/middleware.ts` (enforced, per-request nonce)  
**Fallback:** `frontend/next.config.mjs` `headers()` (static, no nonce — CDN/static export only)  
**Review cadence:** On every RPC vendor change, wallet SDK upgrade, or new third-party integration.

---

## Current Allowlist

### `connect-src` — XHR / fetch / WebSocket

| Host | Purpose | Directive |
|---|---|---|
| `'self'` | Same-origin API calls | Required |
| `$NEXT_PUBLIC_API_URL` (origin only) | Backend REST API | Required |
| `https://soroban-testnet.stellar.org` | Soroban RPC — testnet | Required for testnet |
| `https://horizon-testnet.stellar.org` | Horizon REST — testnet | Required for testnet |
| `wss://soroban-testnet.stellar.org` | Soroban event streaming — testnet | Required for testnet |
| `https://soroban.stellar.org` | Soroban RPC — mainnet | Required for mainnet |
| `https://horizon.stellar.org` | Horizon REST — mainnet | Required for mainnet |
| `wss://soroban.stellar.org` | Soroban event streaming — mainnet | Required for mainnet |
| `https://stellar.expert` | Block explorer links (`explorerUrl()`) | UX only — removable if explorer links are dropped |

### `script-src`

| Source | Purpose |
|---|---|
| `'self'` | App JS bundles |
| `'nonce-{per-request}'` | Next.js inline bootstrapper (`__NEXT_DATA__`, chunk loader) |

No external script hosts are needed. Freighter and xBull inject via **browser extension content scripts**, which run outside the page CSP entirely — no `script-src` entry is required for them.  
Ref: [Freighter CSP docs](https://docs.freighter.app/docs/guide/csp) · [xBull CSP docs](https://docs.xbull.app/integration/csp)

### `style-src`

`'unsafe-inline'` is currently required because Tailwind CSS injects utility classes at runtime.  
**TODO(csp-style-nonce):** Migrate to build-time CSS extraction (`output: 'export'` or a PostCSS pipeline) to remove `'unsafe-inline'` and replace with a style nonce.

---

## Checklist: Adding a New RPC Endpoint

1. Identify the full origin (scheme + host, no path): e.g. `https://rpc.example.com`
2. Add it to `connect-src` in **both** locations:
   - `frontend/src/middleware.ts` → `buildCsp()` connect-src array
   - `frontend/next.config.mjs` → `buildCsp()` connect-src array (static fallback)
3. If the endpoint uses WebSockets, add the `wss://` origin too.
4. Add a comment with the purpose and a link to the vendor's CSP guidance.
5. Deploy to staging → run wallet flows (Freighter + xBull) → check browser console for CSP violations.
6. Update this document's allowlist table.
7. Open a PR; second engineer reviews before merge.

## Checklist: Removing an RPC Endpoint

1. Confirm no code path still calls the host (`grep -r "rpc.example.com" frontend/src`).
2. Remove from both `middleware.ts` and `next.config.mjs`.
3. Test in staging.
4. Update this document.

## Checklist: Adding a New Wallet

1. Check the wallet's CSP documentation.
2. If it requires a `script-src` entry (unlikely for extension-based wallets), add it with a comment linking to the vendor docs.
3. If it opens an iframe (e.g. WalletConnect modal), add the iframe origin to `frame-src` and document why.
4. Test the full connect → sign → submit flow in staging.
5. Update this document.

---

## Report-Only Mode (Iteration Workflow)

Set in `.env` (never commit):

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
3. If you use a CDN in front of the frontend (CloudFront, Cloudflare), verify the CDN forwards the `Content-Security-Policy` response header unchanged. Some CDNs strip or merge security headers.
4. If you use a static export (`next export`), middleware does not run — the static `headers()` in `next.config.mjs` is your only CSP. In that case, nonces are unavailable and you must use `'unsafe-inline'` for scripts or a hash-based approach. Document this trade-off in your deployment runbook.

---

## Violation Triage Guide

| Violation directive | Likely cause | Action |
|---|---|---|
| `script-src` | Third-party script injected without nonce | Investigate source; add nonce or remove script |
| `connect-src` | New RPC/API endpoint not in allowlist | Add per checklist above |
| `style-src` | Dynamic style injection by a UI library | Add nonce to style or accept `unsafe-inline` with justification |
| `frame-src` | Wallet or embed opened in iframe | Add origin to `frame-src` with justification |
| `img-src` | External image (avatar, OG image) | Add origin or proxy through `/_next/image` |

Unexplained `script-src` violations in production should be treated as **security incidents** and escalated immediately.
