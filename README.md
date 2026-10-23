# NiffyInsur

Decentralized insurance platform built on the Stellar/Soroban blockchain.

## Setup

```bash
# 1. Clone
git clone https://github.com/your-org/niff-Stellar-shurance.git && cd niff-Stellar-shurance

# 2. Install
cp frontend/.env.example frontend/.env.local   # fill in values
cd frontend && npm install

# 3. Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Requirements

- Node.js `>=22` (see `.nvmrc`)
- npm `>=10`

## Project Structure

```
frontend/src/
├── app/          # Next.js App Router routes & layouts
├── features/     # Feature modules: policies/, claims/, wallet/
│   └── <feature>/{components,hooks,api}/
├── components/ui/ # Shared primitive components (Shadcn-style)
├── lib/          # Utilities, Stellar SDK wrappers, schemas
└── styles/       # Global CSS and Tailwind theme tokens
```

## Quality Gates

```bash
npm run lint        # ESLint (fails on warnings)
npm run typecheck   # tsc --noEmit strict check
npm run build       # Production build
```

CI runs all three sequentially on every push/PR to `main`.

## Environment Variables

Copy `frontend/.env.example` → `frontend/.env.local`.

- `NEXT_PUBLIC_*` variables are safe for the browser.
- All other variables are **server-only** — never import them in Client Components.
  Use `import '@/lib/server-guard'` at the top of server-only modules to enforce this at build time.

## Mainnet Launch Readiness

Tracking checklist for all items that must be resolved before deploying with
`STELLAR_NETWORK=mainnet`. See [docs/launch-readiness-checklist.md](docs/launch-readiness-checklist.md)
for status, owners, and acceptance criteria. **Priority: Critical — Layer: All.**

## Handsoff notes

<!-- handsoff-issue-1489 -->
- #1489: Backend — Support center: tickets, replies, captcha and FAQ
<!-- handsoff-issue-1490 -->
- #1490: Backend — Posts/announcements with sanitization, scheduling and feeds
<!-- handsoff-issue-1524 -->
- #1524: Frontend — Claim discussion thread
<!-- handsoff-issue-1528 -->
- #1528: Frontend — Vote delegation UI
<!-- handsoff-issue-1537 -->
- #1537: Frontend — Admin configuration: assets, feature flags and pause controls
<!-- handsoff-issue-1538 -->
- #1538: Frontend — Admin governance: voters, delegations and audit log
<!-- handsoff-issue-1539 -->
- #1539: Frontend — Admin content: FAQ and announcements

<!-- handsoff-issue-1479 -->
- #1479: Backend — Claim deadline and payout keeper jobs

<!-- handsoff-issue-818 -->
- #818: Contract — Claim ID overflow guard: u64 counter saturation handling and test

<!-- handsoff-issue-1446 -->
- #1446: Contract — Claim withdrawal and supplementary evidence

<!-- handsoff-issue-1678 -->
- #1678: Frontend: Dashboard card order — implement drag-to-reorder dashboard cards

<!-- handsoff-issue-1672 -->
- #1672: Frontend: Draft persistence — persist claim filing form across page refreshes

<!-- handsoff-issue-1715 -->
- #1715: Frontend: i18n — add missing translation keys for appeal and governance flows

<!-- handsoff-issue-1718 -->
- #1718: Tracking — Full platform launch readiness checklist (see `docs/launch-readiness-checklist.md`)

<!-- handsoff-issue-1708 -->
- #1708: Tracking — Oracle integration: price feed and fraud scoring cross-stack group (umbrella; `feature:oracle`)
  - Contract: sign-then-verify oracle pipeline, vet specialization validation
  - Backend: Prometheus treasury gauge from oracle data
  - Frontend: network status indicator with oracle feed display

<!-- handsoff-issue-1706 -->
- #1706: Tracking — Claim lifecycle: full end-to-end cross-stack issue group
  - Label: `feature:claim-lifecycle` (apply to this umbrella and all linked issues)
  - All linked issues must link back to this umbrella (#1706)
  - Scope covers all layers: contract, backend, frontend
  - Linked work:
    - Contract: status history log, keeper entrypoints, withdraw claim
    - Backend: policy expiry keeper, appeal finalize keeper, claim discussion threads
    - Frontend: discussion thread UI, TxStatusDialog

<!-- handsoff-issue-1619 -->
- #1619: Backend: SSE real-time updates — Redis pub/sub for multi-instance claim status
