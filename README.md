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
