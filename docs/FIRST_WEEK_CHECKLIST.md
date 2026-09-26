# First-Week Contributor Checklist

A step-by-step checklist for setting up the contract, backend, and frontend
environments end-to-end, and running tests for each. Complements
`CONTRIBUTING.md` (which covers guidelines generally) with a concrete,
linear path for a new contributor's first week.

## 1. Prerequisites

- [ ] Install Node.js (`>=22`, see `.nvmrc`) via nvm/fnm, run `nvm use`
- [ ] Install Rust (stable) + `rustup target add wasm32-unknown-unknown`
- [ ] Install Soroban CLI (`cargo install --locked stellar-cli --features opt`)
- [ ] Install Docker
- [ ] Clone the repo: `git clone https://github.com/InsurNiffy/niff-Stellar-shurance.git`

## 2. Local infra

- [ ] Start Postgres + Redis: `docker compose up -d postgres redis` (see
      `docker-compose.yml`)
- [ ] Confirm both containers are healthy: `docker compose ps`

## 3. Contracts (Rust / Soroban)

- [ ] `cd contracts`
- [ ] Build: `cargo build --target wasm32-unknown-unknown --release`
- [ ] Run contract tests: `cargo test`
- [ ] Note any build errors or missing toolchain pieces

## 4. Backend (NestJS)

- [ ] `cd backend && npm install`
- [ ] Copy `.env.example` to `.env` and fill in local values
- [ ] Run migrations (per `backend/README` or `package.json` scripts)
- [ ] Start dev server: `npm run start:dev`
- [ ] Run backend tests: `npm test`

## 5. Frontend (Next.js)

- [ ] `cd frontend && npm install`
- [ ] Copy `.env.example` to `.env.local` and fill in local values
- [ ] Start dev server: `npm run dev`
- [ ] Run frontend tests: `npm test`
- [ ] Confirm the app loads locally and talks to the local backend

## 6. Sanity check

- [ ] Make a trivial change, open a draft PR, confirm CI runs

## Dry-run note

This checklist should be dry-run by a new (or recent) contributor before
being considered final. Gaps or outdated steps found during that dry-run
should be fixed here and the checklist published alongside
`CONTRIBUTING.md` (linked from its table of contents).
