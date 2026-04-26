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
